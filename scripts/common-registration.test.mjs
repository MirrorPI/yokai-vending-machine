import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectProject } from './asset-catalog.mjs';
import { candidatesFor } from '../src/runtime/rules.ts';
import { compileScene, sampleScene } from '../src/scene/composition.ts';
import { freezeCapture, hitCapture } from '../src/capture/scene.ts';
import { decodeRgbaPng } from '../src/capture/png.ts';

const root = new URL('../', import.meta.url).pathname;
const { catalog, report } = inspectProject(decodeURI(root));
const seasons = ['spring', 'summer', 'autumn', 'winter'];
const plan = (id, season = 'spring', family = 'forest', effectsEnabled = true) =>
  compileScene(catalog, { yokaiId: id, season, family, effectsEnabled, playback: { originMs: 0 } });

// Catches registration that changes only status/art without final frames or items.
test('all 68 species have final art; common20 are eligible on all eight maps', () => {
  assert.equal(report.summary.errors, 0);
  assert.equal(report.summary.missingYokaiArt, 0);
  assert.equal(report.summary.bodyFrames, 524);
  for (const season of seasons) for (const family of ['forest', 'hill']) {
    const c = candidatesFor(catalog, season, family);
    assert.equal(c.rule.length, 48);
    assert.equal(c.available.length, 48, JSON.stringify(c.excluded));
    assert.equal(c.excluded.length, 0);
    for (let n = 1; n <= 20; n++) {
      const id = `yokai_${String(n).padStart(3, '0')}`, y = catalog.yokai[n - 1];
      assert.ok(c.available.some(x => x.id === id));
      assert.equal(y.weight, 10);
      assert.equal(y.mainItemId, `item_${String(n).padStart(3, '0')}`);
      assert.equal(catalog.items[n - 1].ownerYokaiId, id);
      assert.equal(y.art.animation.frames.length, 5);
    }
  }
  assert.ok(!catalog.files.some(f => /\/(ref|previews|rigs)\//.test(f.sourcePath)));
});

// Catches missing/incorrect map-specific foreground or treating occlusion as an effect.
test('common rock peeks retain the correct foreground with effects switched off', () => {
  for (const id of ['yokai_003', 'yokai_007']) for (const season of seasons) for (const family of ['forest', 'hill']) {
    const draw = sampleScene(plan(id, season, family, false), 0);
    assert.deepEqual(draw.map(l => l.id), ['background', 'body', 'foreground']);
    assert.equal(draw[2].file.publicPath, `game-assets/배경/${family}/${season}/layers/foreground_rock_left.png`);
  }
});

test('rock peeks retain visible faces and keep covered pixels unclickable', async () => {
  const rasters = new Map();
  for (const [id, face] of [['yokai_003', [32, 199]], ['yokai_007', [23, 197]]]) {
    const y = catalog.yokai.find(y => y.id === id);
    for (const season of seasons) for (const family of ['forest', 'hill']) {
      const p = plan(id, season, family);
      for (const layer of p.layers) for (const file of layer.files) {
        if (!rasters.has(file.sourcePath)) {
          rasters.set(file.sourcePath, await decodeRgbaPng(readFileSync(new URL(`../${file.sourcePath}`, import.meta.url)), file.size));
        }
      }
      for (const sampledAtMono of [0, 2000, 2220, 2860, 3100]) {
        const context = { bundle: { plan: p, requestId: 1 }, sampledAtMono, family, sceneSeason: season, gameSeason: season };
        const sample = freezeCapture(context, { giant: y.giant, metadata: y.art.animation.metadata }, file => rasters.get(file.sourcePath));
        let bodyPixels = 0, hiddenPixels = 0, hiddenPoint;
        for (let py = sample.bounds.top; py < sample.bounds.bottom; py++) for (let px = sample.bounds.left; px < sample.bounds.right; px++) {
          if (!sample.opaque(px, py)) continue;
          bodyPixels++;
          if (sample.occluded(px, py)) { hiddenPixels++; hiddenPoint = [px, py]; }
        }
        const caseId = `${p.mapId}/${id}/${sampledAtMono}`;
        assert.ok(hiddenPixels > 0 && hiddenPixels <= bodyPixels * 0.6, `${caseId} hides ${hiddenPixels} of ${bodyPixels} body pixels`);
        const hit = ([clientX, clientY]) => hitCapture(sample, {
          clientX, clientY, rect: { left: 0, top: 0, width: 192, height: 256 },
          topmostScene: true, modal: false, blockedRects: [],
        });
        assert.ok(sample.opaque(...face) && hit(face), `${caseId} face`);
        assert.equal(hit(hiddenPoint), false, `${caseId} covered body pixel`);
      }
    }
  }
});

test('common steam and dawn are five body-synchronized cells in their authored order', () => {
  for (const [id, effect] of [['yokai_019', 'tea_steam'], ['yokai_020', 'dawn_light']]) {
    const p = plan(id);
    const layer = p.layers.find(l => l.id === effect);
    assert.ok(layer);
    assert.equal(layer.files.length, 5);
    for (const now of [0, 800, 1500, 2200, 5000]) {
      const draw = sampleScene(p, now);
      assert.equal(draw.find(l => l.id === effect).cel, draw.find(l => l.id === 'body').cel);
    }
    assert.deepEqual(sampleScene(plan(id, 'winter', 'hill', false), 0).map(l => l.id), ['background', 'body']);
  }
  assert.deepEqual(sampleScene(plan('yokai_020'), 0).map(l => l.id), ['background', 'body', 'dawn_light']);
});

// Catches using a foot/sitting anchor to crop the long-necked common face.
test('common photographs use authored face anchors in all 160 placements', () => {
  const placements = JSON.parse(readFileSync(new URL('../docs/요괴/공통/preview/placements.json', import.meta.url)));
  for (const row of placements) {
    const [family, season] = row.mapId.split('_'), y = catalog.yokai.find(y => y.id === row.id);
    const p = plan(row.id, season, family);
    const context = { bundle: { plan: p, requestId: 1 }, sampledAtMono: 0, family, sceneSeason: season, gameSeason: season };
    const sample = freezeCapture(context, { giant: y.giant, metadata: y.art.animation.metadata }, f =>
      ({ width: f.size[0], height: f.size[1], data: new Uint8ClampedArray(f.size[0] * f.size[1] * 4) }));
    const [cropX, cropY] = row.photoCrop;
    assert.deepEqual(sample.crop, { x: cropX, y: cropY, width: 96, height: 128 }, row.id);
  }
});

test('rock peeks keep the authored contact height against the fixed foreground', () => {
  for (const id of ['yokai_003', 'yokai_007']) for (const season of seasons) for (const family of ['forest', 'hill']) {
    const y = catalog.yokai.find(y => y.id === id), meta = y.art.animation.metadata;
    const body = plan(id, season, family).layers.find(l => l.id === 'body');
    assert.equal(body.y + meta.anchor[1], meta.contactPoint[1], `${id}/${season}/${family}: displaced rock contact`);
  }
});
