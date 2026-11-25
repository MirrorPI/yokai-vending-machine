import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const scene = await import('../src/scene/composition.ts').catch(e => {
  if (e.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw e;
});
const catalog = JSON.parse(fs.readFileSync(new URL('../src/data/generated/asset-catalog.json', import.meta.url)));
const input = (no, family = 'forest') => ({ family, season: no < 31 ? 'spring' : no < 41 ? 'summer' : no < 51 ? 'autumn' : 'winter', yokaiId: `yokai_${String(no).padStart(3,'0')}`, placement: 'verified-default', playback: { originMs: 1000 } });
const plan = (no, family) => scene.compileScene(catalog, input(no, family));
const layers = (no, elapsed = 0, family) => scene.sampleScene(plan(no, family), elapsed + 1000);

test('ties-to-even handles both signs and does not use Math.round at half pixels', () => {
  assert.equal(typeof scene.roundTiesToEven, 'function');
  for (const [value, expected] of [[-3.5,-4],[-2.5,-2],[-1.5,-2],[-0.5,0],[0.5,0],[1.5,2],[2.5,2],[3.5,4],[2.49,2],[2.51,3]]) assert.equal(scene.roundTiesToEven(value), expected);
});

test('sourceOrigin is already included in the animation anchor; 022/025/026 quantize once', () => {
  for (const [no, xy, size] of [[21,[4,146],[53,53]],[22,[28,120],[38,44]],[25,[148,154],[38,43]],[26,[144,138],[44,59]],[45,[76,92],[45,50]],[53,[119,143],[35,48]],[57,[-3,167],[74,55]]]) {
    const body = layers(no).find(l => l.id === 'body');
    assert.deepEqual([body.x,body.y], xy);
    assert.deepEqual([body.width,body.height], size);
  }
});

test('all 384 approved combinations have exactly one background/body and only resolved catalog paths', () => {
  let count = 0;
  for (const entry of catalog.compatibility.metadata.verifiedDefaults) for (const family of entry.families) {
    const p = scene.compileScene(catalog, { ...input(entry.no, family), season: entry.season });
    const files = scene.sceneFiles(p);
    assert.equal(new Set(files.map(f=>f.publicPath)).size, files.length);
    for (const file of files) assert.ok(fs.existsSync(file.sourcePath), file.sourcePath);
    for (let cel=0;cel<catalog.yokai.find(y=>y.no===entry.no).art.animation.frames.length;cel++) {
      // Sampling at each original step boundary must reach each source cel.
      const m = catalog.yokai.find(y=>y.no===entry.no).art.animation.metadata;
      const step = m.sequence.indexOf(cel);
      const elapsed = m.durationsMs.slice(0,step).reduce((a,b)=>a+b,0) - (m.startOffsetMs ?? 0);
      const draw = scene.sampleScene(p, 1000 + elapsed);
      assert.equal(draw.filter(l=>l.id==='background').length,1);
      assert.equal(draw.filter(l=>l.id==='body').length,1);
      assert.equal(draw.find(l=>l.id==='body').cel,cel);
      assert.ok(draw.every(l=>files.some(f=>f.publicPath===l.file.publicPath)));
    }
    count++;
  }
  assert.equal(count,384);
});

test('full scene giants keep 192×256 frames at 0,0', () => {
  for(const no of [29,30,39,40,49,50,59,60]) {
    const body=layers(no).find(l=>l.id==='body');
    assert.deepEqual([body.x,body.y,body.width,body.height],[0,0,192,256]);
  }
});

test('missing art, season mismatch, arbitrary spots and all 14 rejected trials stay disabled', () => {
  const missing=structuredClone(catalog);missing.yokai[0].art=null;
  assert.throws(()=>scene.compileScene(missing,input(1)),/unavailable/i);
  assert.throws(()=>scene.compileScene(catalog,{...input(21),season:'winter'}),/verified/i);
  assert.throws(()=>scene.compileScene(catalog,{...input(21),placement:'air_left'}),/placement/i);
  assert.equal(catalog.compatibility.metadata.rejectedTypedTrials.length,14);
  for(const t of catalog.compatibility.metadata.rejectedTypedTrials) assert.throws(()=>scene.compileScene(catalog,{...input(t.no,t.mapId.split('_')[0]),placement:t.spot}),/placement/i);
});

test('sequence positions use half-open duration boundaries, offset and stable time origin', () => {
  const track = {sequence:[0,1,2,1],durationsMs:[100,20,30,50],startOffsetMs:10};
  for(const [time,cel] of [[0,0],[89,0],[90,1],[109,1],[110,2],[140,1],[190,0],[-10,0],[-11,1],[390,0]]) assert.equal(scene.frameAt(track,time).cel,cel);
  assert.equal(layers(26,1400).find(l=>l.id==='body').cel,1);
  assert.equal(layers(26,1750).find(l=>l.id==='body').cel,3);
  assert.equal(layers(32,1583).find(l=>l.id==='body').cel,1);
});

test('map foreground replaces the old forest copy without inheriting its 0.5 scale', () => {
  for(const no of [34,47,52]) for(const family of ['forest','hill']) {
    const draw=layers(no,0,family);
    const fg=draw.find(l=>l.id==='foreground');
    assert.equal(fg.file.publicPath,`game-assets/배경/${family}/${input(no).season}/layers/foreground_bush_right.png`);
    assert.deepEqual([fg.x,fg.y,fg.width,fg.height],[0,0,192,256]);
    assert.ok(draw.indexOf(fg)>draw.findIndex(l=>l.id==='body'));
    assert.ok(!scene.sceneFiles(plan(no,family)).some(f=>f.sourcePath.includes(`yokai_${no}_foreground`)));
  }
  const map=catalog.maps.find(m=>m.id==='hill_summer');
  assert.equal(scene.mapForeground(map,'rock_left').publicPath,'game-assets/배경/hill/summer/layers/foreground_rock_left.png');
});

test('baked support stays out of overlay and load list even when effects disabled', () => {
  const p=scene.compileScene(catalog,{...input(53),effectsEnabled:false});
  assert.deepEqual(scene.sampleScene(p,1000).map(l=>l.id),['background','body']);
  assert.ok(!scene.sceneFiles(p).some(f=>/support|icicle/.test(f.sourcePath)));
});

test('halo, electric and bodyCel synchronized auras follow original back/front ordering', () => {
  assert.deepEqual(layers(30).map(l=>l.id),['background','halo','body']);
  assert.deepEqual(layers(40).map(l=>l.id),['background','body','electric']);
  assert.deepEqual(layers(50).map(l=>l.id),['background','moon_aura','moon','body','mane_aura','front_mist']);
  assert.deepEqual(layers(60).map(l=>l.id),['background','wing_aura','body','tail_aura']);
  assert.deepEqual(layers(49).map(l=>l.id),['background','body','fox_bead']);
  for(const no of [50,60]) for(const elapsed of [0,1,143,800,1700,3000,12000]) {
    const draw=layers(no,elapsed); const body=draw.find(l=>l.id==='body');
    for(const aura of draw.filter(l=>l.id.includes('aura'))) assert.equal(aura.cel,body.cel);
  }
  assert.deepEqual(scene.sampleScene(scene.compileScene(catalog,{...input(60),effectsEnabled:false}),1000).map(l=>l.id),['background','body']);
});

test('independent auxiliary timing shares body start offset; logicalScale applies to source dimensions and anchors', () => {
  const c=structuredClone(catalog); const y=c.yokai.find(y=>y.no===40);
  const l=y.art.animation.layers[0];
  l.metadata={...l.metadata,frameSize:[384,512],logicalScale:0.5,anchor:[4,6],contactPoint:[8,10],sequence:[4,3,2,1,0],durationsMs:[100,100,100,100,100]};
  const p=scene.compileScene(c,input(40)); const effect=scene.sampleScene(p,1000).find(l=>l.id==='electric');
  assert.deepEqual([effect.x,effect.y,effect.width,effect.height,effect.cel],[6,7,192,256,0]);
});

test('empty scene uses the catalog map only and integer fit respects reserved 64px', () => {
  const p=scene.compileScene(catalog,{family:'hill',season:'winter',yokaiId:null,playback:{originMs:0}});
  assert.deepEqual(scene.sampleScene(p,0).map(l=>l.id),['background']);
  assert.equal(scene.sceneFiles(p).length,1);
  for(const [w,h,scale] of [[384,576,2],[192,320,1],[1000,900,2],[383,576,1],[384,575,1],[100,200,1]]) assert.equal(scene.integerSceneScale(w,h),scale);
});

test('integer layout snaps centering to whole CSS pixels even in odd viewports', () => {
  assert.equal(typeof scene.integerSceneLayout,'function');
  assert.deepEqual(scene.integerSceneLayout(385,577),{scale:2,left:0,top:0});
  assert.deepEqual(scene.integerSceneLayout(1001,901),{scale:2,left:308,top:162});
});
