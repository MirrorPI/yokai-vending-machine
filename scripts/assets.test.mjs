import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectProject } from './asset-catalog.mjs';
import { runAssets } from './assets.mjs';

const sourceRoot = new URL('../', import.meta.url).pathname;
// A narrow real project fixture: copy only the audited sources, never archive or production inputs.
async function project(t) {
  const { cpSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'yokai-a01-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of inspectProject(decodeURI(sourceRoot)).catalog.files) {
    mkdirSync(dirname(join(root, file.sourcePath)), { recursive: true });
    cpSync(join(decodeURI(sourceRoot), file.sourcePath), join(root, file.sourcePath));
  }
  return root;
}

test('생성 목록은 원본 변경을 감지하고 검사는 파일을 쓰지 않는다', async t => {
  const root = await project(t);
  runAssets('generate', root);
  const catalogPath = join(root, 'src/data/generated/asset-catalog.json');
  assert.ok(existsSync(catalogPath));
  const before = readFileSync(catalogPath, 'utf8');
  runAssets('check', root);
  assert.equal(readFileSync(catalogPath, 'utf8'), before);
  writeFileSync(catalogPath, '{}');
  assert.throws(() => runAssets('check', root), /stale/i);
  runAssets('generate', root);
  const original = join(root, 'docs/아이템/items.json');
  writeFileSync(original, `${readFileSync(original, 'utf8')}\n`);
  assert.throws(() => runAssets('check', root), /stale/i);
});

test('빌드 복사본은 목록과 바이트가 같고 제작 후보가 포함되지 않는다', async t => {
  const root = await project(t);
  runAssets('generate', root);
  runAssets('sync', root);
  const png = 'public/game-assets/아이템/pixel/item_001.png';
  assert.deepEqual(readFileSync(join(root, png)), readFileSync(join(root, 'docs/아이템/pixel/item_001.png')));
  assert.ok(existsSync(join(root, 'public/game-assets/배경/astronomy/sources.txt')));
  assert.equal(existsSync(join(root, 'public/game-assets/아이템/ref')), false);
  assert.equal(existsSync(join(root, 'public/game-assets/요괴/가을/archive')), false);
  // Re-running removes obsolete files from the generated destination only.
  writeFileSync(join(root, 'public/game-assets/old.png'), 'stale');
  runAssets('sync', root);
  assert.equal(existsSync(join(root, 'public/game-assets/old.png')), false);
  assert.deepEqual(readFileSync(join(root, png)), readFileSync(join(root, 'docs/아이템/pixel/item_001.png')));
});

test('공통 등록 후 일반 검사와 strict 모두 누락 없이 통과한다', async t => {
  const root = await project(t);
  runAssets('generate', root);
  assert.equal(runAssets('check', root).summary.missingYokaiArt, 0);
  assert.equal(runAssets('strict', root).summary.errors, 0);
});
