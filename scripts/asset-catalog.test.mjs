import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { inspectProject } from './asset-catalog.mjs';

const root = resolve(import.meta.dirname, '..');
const patterns = [
  'docs/요괴/서양추가10/{western_yokai.json,placements.json}',
  'docs/요괴/서양추가10/animation/**/*.png',
  'docs/요괴/서양추가10/animation/manifest.json',
  'docs/요괴/서양추가10/pixel/yokai_???.png',
  'docs/요괴/서양추가10/items/{items.json,pixel/*.png}',
  'docs/요괴/계절추가24/{season_expansion_yokai.json,placements.json}',
  'docs/요괴/계절추가24/animation/**/*.png',
  'docs/요괴/계절추가24/animation/manifest.json',
  'docs/요괴/계절추가24/pixel/yokai_???.png',
  'docs/요괴/계절추가24/items/{items.json,pixel/*.png}',
  'docs/요괴자판기_기획서_v1.7.md',
  'docs/배경/{map_manifest.json,integration_notes.txt}',
  'docs/배경/astronomy/sources.txt',
  'docs/배경/adapters/*.json',
  'docs/배경/{forest,hill}/**/*.{png,json}',
  'docs/아이템/{items.json,integration_notes.txt}',
  'docs/아이템/pixel/*.png',
  'docs/요괴/{공통,봄,여름,가을,겨울,사계절추가}/*_yokai.json',
  'docs/요괴/{공통,사계절추가}/app_registration.json',
  'docs/아이템/추가/{items.json,pixel/*.png}',
  'docs/요괴/{가을,겨울}/layout.json',
  'docs/요괴/{공통,봄,여름,가을,겨울,사계절추가}/pixel/*.png',
  'docs/요괴/{공통,봄,여름,가을,겨울,사계절추가}/animation/manifest.json',
  'docs/요괴/{공통,봄,여름,가을,겨울,사계절추가}/animation/{frames,sheets,layers}/*.png',
];
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'yokai-a01-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const path of globSync(patterns, { cwd: root })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    cpSync(join(root, path), join(dir, path));
  }
  return dir;
}
function edit(dir, path, mutate) {
  const value = JSON.parse(readFileSync(join(dir, path), 'utf8'));
  mutate(value);
  writeFileSync(join(dir, path), JSON.stringify(value));
}
const codes = result => result.report.issues.map(issue => issue.code);

test('현재 자료의 공통30종과 계절72종을 최종 에셋으로 연결한다', () => {
  const { catalog, report } = inspectProject(root);
  assert.equal(catalog.yokai.length, 102);
  assert.equal(catalog.items.length, 102);
  assert.equal(catalog.maps.length, 8);
  assert.equal(report.summary.errors, 0);
  assert.equal(report.summary.missingYokaiArt, 0);
  assert.equal(report.summary.bodyFrames, 524);
  assert.equal(catalog.yokai[0].art.still.sourcePath, 'docs/요괴/공통/pixel/yokai_001.png');
  assert.equal(catalog.yokai[20].art.still.sourcePath, 'docs/요괴/봄/pixel/yokai_021.png');
  assert.equal(catalog.yokai[20].art.animation.frames[0].publicPath, 'game-assets/요괴/봄/animation/frames/yokai_021_00.png');
  assert.equal(catalog.items[0].icon.sourcePath, 'docs/아이템/pixel/item_001.png');
});

test('원본 상대경로와 대체 전경·지지물 및 반픽셀 메타데이터를 보존한다', () => {
  const { catalog } = inspectProject(root);
  const spring = catalog.yokai.find(y => y.id === 'yokai_022');
  assert.deepEqual(spring.art.animation.metadata.anchor, [18.5, 40]);
  const summer = catalog.yokai.find(y => y.id === 'yokai_034');
  assert.equal(summer.art.animation.layers[0].usage, 'map-foreground');
  const winter = catalog.yokai.find(y => y.id === 'yokai_053');
  assert.equal(winter.art.animation.layers[0].usage, 'included-in-map-scene');
  const halo = catalog.yokai.find(y => y.id === 'yokai_030');
  assert.equal(halo.art.animation.halo.sourcePath, 'docs/요괴/봄/animation/layers/yokai_030_halo.png');
  assert.equal(catalog.maps.find(m => m.id === 'hill_winter').foreground.bush_right.sourcePath,
    'docs/배경/hill/winter/layers/foreground_bush_right.png');
});

test('중복 ID와 소유 요괴 1:1 위반을 거부한다', t => {
  const dir = fixture(t);
  edit(dir, 'docs/아이템/items.json', items => { items[1].id = 'item_001'; items[1].ownerYokaiId = 'yokai_001'; });
  const result = codes(inspectProject(dir));
  assert.ok(result.includes('DUPLICATE_ID'));
  assert.ok(result.includes('MISSING_ID'));
  assert.ok(result.includes('OWNER_NOT_ONE_TO_ONE'));
});

test('계절 데이터·manifest·layout의 누락과 불일치를 드러낸다', t => {
  const dir = fixture(t);
  edit(dir, 'docs/요괴/봄/spring_yokai.json', data => data.pop());
  edit(dir, 'docs/요괴/가을/layout.json', data => { data[4].contactPoint = [98, 134]; });
  const result = codes(inspectProject(dir));
  assert.ok(result.includes('MISSING_ID'));
  assert.ok(result.includes('LAYOUT_MISMATCH'));
});

test('없는 PNG와 손상된 PNG를 정상 에셋으로 세지 않는다', t => {
  const dir = fixture(t);
  rmSync(join(dir, 'docs/요괴/봄/animation/frames/yokai_021_00.png'));
  writeFileSync(join(dir, 'docs/아이템/pixel/item_001.png'), 'broken');
  const result = codes(inspectProject(dir));
  assert.ok(result.includes('FILE_MISSING'));
  assert.ok(result.includes('PNG_INVALID'));
});

test('재생 인덱스·시간·필수 좌표·보조층 메타데이터를 검사한다', t => {
  const dir = fixture(t);
  edit(dir, 'docs/요괴/여름/animation/manifest.json', manifest => {
    manifest.characters[0].sequence[0] = 5;
    manifest.characters[1].durationsMs[0] = 0;
    delete manifest.characters[2].anchor;
    delete manifest.characters[9].layers[0].frameSize;
  });
  const result = codes(inspectProject(dir));
  assert.ok(result.includes('ANIMATION_INVALID'));
  assert.ok(result.includes('METADATA_REQUIRED'));
});

test('정의 기준을 벗어나는 경로와 archive·후보·검수 이미지를 거부한다', t => {
  const dir = fixture(t);
  edit(dir, 'docs/아이템/items.json', items => { items[0].icon = '../ref/candidate.png'; });
  edit(dir, 'docs/요괴/봄/animation/manifest.json', manifest => {
    manifest.characters[0].frames[0] = '../archive/old.png';
  });
  assert.ok(codes(inspectProject(dir)).includes('PATH_NOT_FINAL'));
});

test('맵 family·season 중복 및 adapter 연결 불일치를 검사한다', t => {
  const dir = fixture(t);
  edit(dir, 'docs/배경/map_manifest.json', manifest => { manifest.maps[1].season = 'spring'; });
  edit(dir, 'docs/배경/adapters/forest_winter.json', adapter => { adapter.mapId = 'hill_winter'; });
  const result = codes(inspectProject(dir));
  assert.ok(result.includes('MAP_COMBINATION_INVALID'));
  assert.ok(result.includes('ADAPTER_MISMATCH'));
});

test('원본 이미지의 SHA256과 치수를 기록하고 실제 파일을 가리킨다', () => {
  const { catalog } = inspectProject(root);
  const icon = catalog.items[0].icon;
  assert.match(icon.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(icon.size, [16, 16]);
  assert.ok(existsSync(join(root, icon.sourcePath)));
});

test('다른 아이템/프레임이 같은 경로를 잘못 재사용하면 중복을 보고한다', t => {
  const dir = fixture(t);
  edit(dir, 'docs/아이템/items.json', items => { items[1].icon = items[0].icon; });
  edit(dir, 'docs/요괴/봄/animation/manifest.json', manifest => {
    manifest.characters[0].frames[1] = manifest.characters[0].frames[0];
  });
  assert.ok(codes(inspectProject(dir)).includes('DUPLICATE_PATH'));
});

test('명시된 배경 해시가 실제 원본과 다르면 불일치를 보고한다', t => {
  const dir = fixture(t);
  edit(dir, 'docs/배경/map_manifest.json', manifest => {
    manifest.maps[0].layerHashes.machine = '0'.repeat(64);
  });
  assert.ok(codes(inspectProject(dir)).includes('HASH_MISMATCH'));
});

test('보조층의 실제 이미지·프레임·시트 참조가 모두 없으면 거부한다', t => {
  const dir = fixture(t);
  edit(dir, 'docs/요괴/가을/animation/manifest.json', manifest => {
    delete manifest.characters[8].layers[0].image;
  });
  assert.ok(codes(inspectProject(dir)).includes('LAYER_ASSET_REQUIRED'));
});

test('보조 애니메이션 셀 경로가 중복되면 거부한다', t => {
  const dir = fixture(t);
  edit(dir, 'docs/요괴/겨울/animation/manifest.json', manifest => {
    const layer = manifest.characters[9].layers[0];
    layer.frames[1] = layer.frames[0];
  });
  assert.ok(codes(inspectProject(dir)).includes('DUPLICATE_PATH'));
});

// Approval must bind the exact files/coordinates reviewed, not a status string.
test('공통 승인 원본이 변조되거나 해시/배치가 빠지면 등록을 거부한다', t => {
  const dir = fixture(t);
  edit(dir, 'docs/요괴/공통/animation/manifest.json', m => { m.characters[0].anchor[0]++; });
  edit(dir, 'docs/요괴/공통/app_registration.json', r => {
    delete r.sourceHashes['docs/요괴/공통/animation/frames/yokai_002_00.png'];
    r.verifiedDefaults.pop();
  });
  const found = codes(inspectProject(dir));
  for (const code of ['COMMON_APPROVAL_STALE', 'MISSING_ID', 'PLACEMENT_MISMATCH']) assert.ok(found.includes(code), code);
});

test('공통의 중복 번호와 기획서 고정 항목 변경을 거부한다', t => {
  const dir = fixture(t);
  edit(dir, 'docs/요괴/공통/common_yokai.json', rows => { rows[0].name = '변경'; rows[1].id = rows[0].id; });
  const found = codes(inspectProject(dir));
  assert.ok(found.includes('COMMON_SPEC_MISMATCH'));
  assert.ok(found.includes('DUPLICATE_ID'));
});

// Extra package approvals protect definitions, original pixels and placement together.
test('추가 패키지 승인 해시·등급·배치 변조를 거부한다', t => {
  const dir=fixture(t);
  edit(dir, 'docs/요괴/사계절추가/animation/manifest.json', m=>m.characters[0].anchor[0]++);
  edit(dir, 'docs/요괴/사계절추가/app_registration.json', r=>{
    delete r.sourceHashes['docs/아이템/추가/pixel/item_061.png'];
    r.definitions[0].rarity='special'; r.verifiedDefaults.pop();
  });
  const found=codes(inspectProject(dir));
  for(const code of ['EXTRA_APPROVAL_STALE','DEFINITION_INVALID','MISSING_ID','PLACEMENT_MISMATCH']) assert.ok(found.includes(code),code);
});
