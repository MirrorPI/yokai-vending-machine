import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectProject, serialize } from './asset-catalog.mjs';

const CATALOG = 'src/data/generated/asset-catalog.json';
const REPORT = 'docs/development/a01-asset-report.json';
const MARKDOWN = 'docs/development/a01-asset-report.md';
const link = ref => ref ? `\`${ref.sourcePath}\`` : '없음';
function markdown(catalog, report) {
  const s = report.summary;
  return [
    '# A01 에셋 연결 및 검사 결과', '',
    '자동 생성: `npm run assets:generate`. 원본 정의는 수정하지 않는다.', '',
    `요괴 ID ${s.yokai} / 아이템 ID ${s.items} / 맵 ${s.maps}. 오류 ${s.errors}, 미제작 요괴 ${s.missingYokaiArt}.`,
    `정지 이미지 ${s.stills}, 본체 프레임 ${s.bodyFrames}, 아이템 아이콘 ${s.itemIcons}. 연결 파일 ${s.files}개.`, '',
    '`sourcePath`는 프로젝트 루트 기준 원본, `publicPath`는 public/ 기준 복사본이다. 예: ' +
    '`docs/아이템/pixel/item_001.png` → `public/game-assets/아이템/pixel/item_001.png` → `${BASE_URL}game-assets/아이템/pixel/item_001.png`.',
    '전체 프레임·보조층·원본 메타데이터·SHA256·파일별 실제 존재 결과는 [앱 목록](../../src/data/generated/asset-catalog.json)에 있다. ' +
    '정의와 프레임 경로의 기준 및 복사 정책은 [구조 설명](a01-architecture.md)을 따른다.', '',
    '## 배경 8맵', '', '| ID | family | season | scene 원본 | adapter |', '|---|---|---|---|---|',
    ...catalog.maps.map(m => `| ${m.id} | ${m.family} | ${m.season} | ${link(m.scene)} | \`docs/배경/${m.metadata.adapter}\` |`), '',
    `## 요괴 ${catalog.yokai.length}종`, '', '| 요괴 ID | 이름 | 대표 아이템 | 최종 정지 원본 | 본체 프레임 | 보조층 | 정의 |', '|---|---|---|---|---|---|---|',
    ...catalog.yokai.map(y => `| ${y.id} | ${y.name} | ${y.mainItemId} | ${link(y.art?.still)} | ${y.art?.animation.frames.filter(Boolean).length ?? 0}/5 | ` +
      `${y.art ? [y.art.animation.halo ? 'halo' : '', ...y.art.animation.layers.map(l => `${l.metadata.type} (${l.usage})`)].filter(Boolean).join(', ') || '없음' : '미제작'} | ${y.definitionStatus} |`), '',
    `## 아이템 ${catalog.items.length}종`, '', '| 아이템 ID | 소유 요괴 | 이름 | 아이콘 원본 (16×16) |', '|---|---|---|---|',
    ...catalog.items.map(i => `| ${i.id} | ${i.ownerYokaiId} | ${i.name} | ${link(i.icon)} |`), '',
    '## 누락·불일치·해석 사항', '', '| 구분 | 코드 | 대상 | 내용 |', '|---|---|---|---|',
    ...report.issues.map(i => `| ${i.severity} | ${i.code} | ${i.subject} | ${i.detail.replaceAll('|', '/')} |`), '',
    '## 검증 한계', '', ...report.limits.map(l => `- ${l}`), '',
    '기본 검사와 `npm run assets:check -- --strict`는 공통28종/계절40종 최종 자산을 검사한다. ' +
    '오류나 미제작 패키지는 strict 실패다. 에셋 등록은 A11 또는 전체 게임 완료를 뜻하지 않는다.', '',
  ].join('\n');
}

/** Does not start a listener. Writes only generated outputs; original docs are read-only inputs. */
export function runAssets(action, root = resolve(import.meta.dirname, '..')) {
  if (!['generate', 'check', 'sync', 'strict'].includes(action)) throw new Error(`Unknown action: ${action}`);
  const { catalog, report } = inspectProject(root);
  const outputs = new Map([[CATALOG, serialize(catalog)], [REPORT, serialize(report)], [MARKDOWN, markdown(catalog, report)]]);
  if (action === 'generate') {
    for (const [path, body] of outputs) {
      // Leave the previous usable app catalog intact if source validation fails.
      if (path === CATALOG && report.summary.errors) continue;
      mkdirSync(dirname(resolve(root, path)), { recursive: true });
      writeFileSync(resolve(root, path), body);
    }
  }
  if (report.summary.errors) throw new Error(`Asset audit: ${report.summary.errors} errors\n` +
    report.issues.filter(i => i.severity === 'error').map(i => `${i.code} ${i.subject}: ${i.detail}`).join('\n'));
  if (action !== 'generate') {
    for (const [path, body] of outputs) {
      if (!existsSync(resolve(root, path)) || readFileSync(resolve(root, path), 'utf8') !== body) {
        throw new Error(`Generated output stale: ${path}. Run npm run assets:generate and review the report.`);
      }
    }
  }
  if (action === 'strict' && report.summary.missing) throw new Error(`${report.summary.missing} missing yokai asset packages`);
  if (action === 'sync') {
    // This directory is exclusively generated. No deletion or copy ever targets original docs.
    const destination = resolve(root, 'public/game-assets');
    rmSync(destination, { recursive: true, force: true });
    for (const ref of catalog.files) {
      const target = resolve(root, 'public', ref.publicPath);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(resolve(root, ref.sourcePath), target);
    }
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const action = process.argv.includes('--strict') ? 'strict' : process.argv[2] ?? 'check';
    const { summary } = runAssets(action);
    console.log(`${action}: ${summary.maps} maps, ${summary.yokai} yokai IDs, ${summary.items} items, ` +
      `${summary.files} files; ${summary.errors} errors, ${summary.missingYokaiArt} missing yokai art packages.`);
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
