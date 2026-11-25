import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const SPEC = 'docs/요괴자판기_기획서_v1.7.md';
const BG = 'docs/배경';
const SEASONS = { spring: '봄', summer: '여름', autumn: '가을', winter: '겨울' };
const RARITIES = { 일반: 'common', 희귀: 'rare', 전설: 'legendary', 특수: 'special' };
const id = (kind, no) => `${kind}_${String(no).padStart(3, '0')}`;
const numbers = (first, last) => Array.from({ length: last - first + 1 }, (_, i) => first + i);
const pair = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const serialize = value => `${JSON.stringify(value, null, 2)}\n`;

/** Read-only audit. Paths are interpreted by the owning contract, never guessed by basename. */
export function inspectProject(root) {
  root = realpathSync(root);
  const issues = [], files = new Map();
  const issue = (severity, code, subject, detail) => issues.push({ severity, code, subject, detail });
  const error = (code, subject, detail) => issue('error', code, subject, detail);
  const note = (code, subject, detail) => issue('note', code, subject, detail);
  function file(sourcePath, size = null) {
    if (typeof sourcePath !== 'string' || !sourcePath.startsWith('docs/') ||
        /(^|\/)(archive|ref|candidates?|previews?|draft)(\/|$)/i.test(sourcePath) ||
        sourcePath.includes('..') || sourcePath.includes('\\') || isAbsolute(sourcePath)) {
      error('PATH_NOT_FINAL', String(sourcePath), '원본 정의 기준 밖의 경로 또는 최종 에셋이 아닌 경로');
      return null;
    }
    if (files.has(sourcePath)) {
      const found = files.get(sourcePath);
      if (size && !same(found.size, size)) error('PNG_SIZE', sourcePath, `기대 ${size}, 실제 ${found.size}`);
      return found;
    }
    let bytes;
    try {
      const absolute = realpathSync(resolve(root, sourcePath));
      if (relative(root, absolute).startsWith('..')) throw new Error('프로젝트 외부 경로');
      bytes = readFileSync(absolute);
    } catch (e) {
      error('FILE_MISSING', sourcePath, e.code || e.message);
      return null;
    }
    const ref = { sourcePath, publicPath: `game-assets/${sourcePath.slice(5)}`,
      sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, size: null };
    if (sourcePath.endsWith('.png')) {
      if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
          bytes.toString('ascii', 12, 16) !== 'IHDR') {
        error('PNG_INVALID', sourcePath, 'PNG signature / IHDR가 없음');
        return null;
      }
      ref.size = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
      if (size && !same(ref.size, size)) error('PNG_SIZE', sourcePath, `기대 ${size}, 실제 ${ref.size}`);
    }
    files.set(sourcePath, ref);
    return ref;
  }
  function json(path) {
    if (!file(path)) return null;
    try { return JSON.parse(readFileSync(resolve(root, path), 'utf8')); }
    catch (e) { error('JSON_INVALID', path, e.message); return null; }
  }
  function array(value, subject) {
    if (Array.isArray(value)) return value;
    error('METADATA_REQUIRED', subject, '배열이 필요함');
    return [];
  }
  function ids(rows, expected, subject, key = 'id') {
    const seen = new Set();
    for (const row of rows) {
      const value = row?.[key];
      if (seen.has(value)) error('DUPLICATE_ID', subject, String(value));
      if (!expected.includes(value)) error('UNEXPECTED_ID', subject, String(value));
      seen.add(value);
    }
    for (const value of expected) if (!seen.has(value)) error('MISSING_ID', subject, String(value));
  }
  function required(object, keys, subject) {
    for (const key of keys) if (object[key] == null || object[key] === '') {
      error('METADATA_REQUIRED', subject, key);
    }
  }
  function spatial(object, subject) {
    for (const key of ['frameSize', 'anchor', 'contactPoint']) {
      if (!pair(object[key])) error('METADATA_REQUIRED', subject, `${key}: 유한수 좌표 쌍 필요`);
    }
    if (!Number.isInteger(object.frameCount) || object.frameCount < 1) {
      error('METADATA_REQUIRED', subject, 'frameCount: 양의 정수 필요');
    }
  }
  function playback(object, subject) {
    const { sequence, durationsMs, frameCount } = object;
    if (!Array.isArray(sequence) || !sequence.length || !Array.isArray(durationsMs) ||
        sequence.length !== durationsMs.length || sequence.some(n => !Number.isInteger(n) || n < 0 || n >= frameCount) ||
        durationsMs.some(n => !Number.isFinite(n) || n <= 0)) {
      error('ANIMATION_INVALID', subject, 'sequence 인덱스와 양의 durationsMs가 대응해야 함');
    }
  }
  function uniquePaths(paths, subject) {
    const seen = new Set();
    for (const path of paths) {
      if (seen.has(path)) error('DUPLICATE_PATH', subject, String(path));
      seen.add(path);
    }
  }
  function local(base, path, size) {
    // Do not normalize traversal before checking: a forbidden archive path must stay visible.
    if (typeof path !== 'string') { error('METADATA_REQUIRED', base, '파일 경로 필요'); return null; }
    return file(`${base}/${path}`, size);
  }

  file(SPEC);
  const spec = files.has(SPEC) ? readFileSync(resolve(root, SPEC), 'utf8') : '';
  const specRows = [...spec.matchAll(/^\| (\d{2}) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)]
    .map(match => match.slice(1).map(value => value.trim().replaceAll('**', '')));
  const commonRows = specRows.filter(row => Number(row[0]) <= 20);
  ids(commonRows.map(row => ({ id: id('yokai', Number(row[0])) })), numbers(1, 20).map(n => id('yokai', n)), `${SPEC} §7 공통 표`);
  const commonSpec = commonRows.map(([num, name, origin, rarity, spots, size, story, favoriteDrink]) => {
    const no = Number(num), [lore, description] = story.split(' → ');
    return { id: id('yokai', no), no, name, origin: origin.includes('·') ? 'kr_jp' : origin.startsWith('한') ? 'kr' : 'jp',
      seasons: Object.keys(SEASONS), rarity: RARITIES[rarity], spots: spots.split(', '), size,
      lore, description, favoriteDrink, definitionSource: `${SPEC}#§7-공통-표`, definitionStatus: 'spec-table-only',
      mainItemId: id('item', no), legacyImage: null, art: null };
  });
  const registrationPath = 'docs/요괴/공통/app_registration.json';
  const registration = json(registrationPath) ?? {};
  if (registration.defaultWeight !== 10) error('DEFINITION_INVALID', registrationPath, '기획서 기본 weight=10 필요');
  const registeredHashes = registration.sourceHashes ?? {};
  for (const [path, hash] of Object.entries(registeredHashes)) {
    const ref = file(path);
    if (!ref || ref.sha256 !== hash) error('COMMON_APPROVAL_STALE', path, '승인 당시 원본과 SHA256 불일치');
  }

  const extraBase = 'docs/요괴/사계절추가';
  const extraRegistrationPath = `${extraBase}/app_registration.json`;
  const extraRegistration = json(extraRegistrationPath) ?? {};
  if (extraRegistration.defaultWeight !== 10) error('DEFINITION_INVALID', extraRegistrationPath, '기본 weight=10 필요');
  const extraCanonical = array(extraRegistration.definitions, extraRegistrationPath);
  ids(extraCanonical, numbers(61, 68).map(n => id('yokai', n)), extraRegistrationPath);
  const expectedExtraRanks = ['common', 'common', 'common', 'rare', 'rare', 'rare', 'legendary', 'special'];
  for (const c of extraCanonical) if (c.rarity !== expectedExtraRanks[c.no - 61]) error('DEFINITION_INVALID', c.id, '추가 등급 구성 3/3/1/1 필요');
  const extraHashes = extraRegistration.sourceHashes ?? {};
  for (const [path, hash] of Object.entries(extraHashes)) {
    const ref = file(path);
    if (!ref || ref.sha256 !== hash) error('EXTRA_APPROVAL_STALE', path, '추가 패키지 승인 원본과 SHA256 불일치');
  }

  const itemsPath = 'docs/아이템/items.json';
  const rawItems = array(json(itemsPath), itemsPath);
  ids(rawItems, numbers(1, 60).map(n => id('item', n)), itemsPath);
  const extraItemsPath = 'docs/아이템/추가/items.json';
  const extraItems = array(json(extraItemsPath), extraItemsPath);
  ids(extraItems, numbers(61, 68).map(n => id('item', n)), extraItemsPath);
  uniquePaths(rawItems.map(item => item.icon), itemsPath);
  const itemSpec = [...spec.matchAll(/^\| (\d{2}) \| `(yokai_\d{3})` \| ([^|]+) \| `(item_\d{3})` \| ([^|]+) \| ([^|]+) \|$/gm)]
    .map(m => ({ id: m[4], ownerYokaiId: m[2], name: m[5].trim(), description: m[6].trim() }));
  ids(itemSpec, numbers(1, 60).map(n => id('item', n)), `${SPEC} §7-1`);
  const extraItemSpec = array(extraRegistration.items, extraRegistrationPath);
  ids(extraItemSpec, numbers(61, 68).map(n => id('item', n)), extraRegistrationPath);
  const expansionBase = 'docs/요괴/계절추가24';
  const expansionItemsPath = `${expansionBase}/items/items.json`;
  const expansionItems = array(json(expansionItemsPath), expansionItemsPath);
  ids(expansionItems, numbers(69, 92).map(n => id('item', n)), expansionItemsPath);
  const westernBase = 'docs/요괴/서양추가10';
  const westernItemsPath = `${westernBase}/items/items.json`;
  const westernItems = array(json(westernItemsPath), westernItemsPath);
  ids(westernItems, numbers(93, 102).map(n => id('item', n)), westernItemsPath);
  const items = [...rawItems, ...extraItems, ...expansionItems, ...westernItems].map(item => {
    const source = westernItems.includes(item) ? westernItemsPath : expansionItems.includes(item) ? expansionItemsPath : extraItems.includes(item) ? extraItemsPath : itemsPath;
    required(item, ['id', 'ownerYokaiId', 'name', 'description', 'icon'], itemsPath);
    const canonical = [...itemSpec, ...extraItemSpec].find(row => row.id === item.id);
    if (canonical && ['ownerYokaiId', 'name', 'description'].some(k => item[k] !== canonical[k])) {
      error('ITEM_SPEC_MISMATCH', item.id, 'v1.7 정식 표와 ID/소유자/이름/설명 불일치');
    }
    if (item.icon !== `pixel/${item.id}.png`) error('PATH_NOT_FINAL', item.id, String(item.icon));
    // Use the original approved item artwork from items.json.
    return { ...item, definitionSource: source, icon: local(dirname(source), item.icon, [16, 16]) };
  });

  const yokai = [], bodyPaths = [];
  const groups = [['common', '공통'], ...Object.entries(SEASONS), ['common_extra', '사계절추가'], ['season_expansion', '계절추가24'], ['western', '서양추가10']];
  for (const [index, [season, korean]] of groups.entries()) {
    const isWestern = season === 'western', isExpansion = season === 'season_expansion', isExtra = season === 'common_extra', isCommon = season === 'common' || isExtra;
    const base = `docs/요괴/${korean}`, definitionPath = `${base}/${isExtra ? 'common_extra' : isCommon ? 'common' : season}_yokai.json`;
    const manifestPath = `${base}/animation/manifest.json`;
    const definitions = array(json(definitionPath), definitionPath);
    const manifest = json(manifestPath) ?? {};
    const characters = array(manifest.characters, manifestPath);
    const expectedNos = isWestern ? numbers(93, 102) : isExpansion ? numbers(69, 92) : isExtra ? numbers(61, 68) : isCommon ? numbers(1, 20) : numbers(11 + index * 10, 20 + index * 10);
    const expected = expectedNos.map(n => id('yokai', n));
    ids(definitions, expected, definitionPath); ids(characters, expected, manifestPath);
    if (manifest.frameCountPerCharacter !== (isExpansion || isWestern ? 'variable' : 5)) error('METADATA_REQUIRED', manifestPath, 'frameCountPerCharacter=5');
    let layout = [];
    if (['autumn', 'winter'].includes(season)) {
      const value = json(`${base}/layout.json`);
      layout = array(Array.isArray(value) ? value : value?.characters, `${base}/layout.json`);
      ids(layout, expectedNos, `${base}/layout.json`, 'no');
    }
    for (const sourceDefinition of definitions) {
      const canonical = (isExtra ? extraCanonical : commonSpec).find(row => row.id === sourceDefinition.id);
      const definition = isCommon ? { ...sourceDefinition, origin: canonical?.origin,
        weight: (isExtra ? extraRegistration : registration).defaultWeight, registrationStatus: 'registered' } : sourceDefinition;
      const subject = definition.id;
      if (isCommon && (!canonical || ['no', 'name', 'rarity', 'size', 'lore', 'description', 'favoriteDrink', 'mainItemId', 'seasons', 'spots']
        .some(k => !same(definition[k], canonical[k])))) error('COMMON_SPEC_MISMATCH', subject, '공통 표의 고정 정의와 불일치');
      required(definition, ['id', 'no', 'name', 'origin', 'seasons', 'rarity', 'weight', 'spots', 'size',
        'presentation', 'image', 'lore', 'description', 'favoriteDrink'], subject);
      if (definition.id !== id('yokai', definition.no) || !same(definition.seasons, isWestern ? (definition.no<=94 ? Object.keys(SEASONS) : [Object.keys(SEASONS)[Math.floor((definition.no-95)/2)]]) : isCommon ? Object.keys(SEASONS) : [isExpansion ? Object.keys(SEASONS)[Math.floor((definition.no - 69) / 6)] : season]) ||
          !Object.values(RARITIES).includes(definition.rarity) || !(definition.weight > 0)) {
        error('DEFINITION_INVALID', subject, '번호/계절/희귀도/가중치 불일치');
      }
      const c = characters.find(row => row.id === subject);
      let art = null;
      if (c) {
        for (const key of ['no', 'name', 'rarity']) if (!same(c[key], definition[key])) error('MANIFEST_MISMATCH', subject, key);
        spatial(c, subject); playback(c, subject);
        required(c, ['sourceOrigin', 'giant', 'columns', 'sheet', 'frames'], subject);
        if (!pair(c.sourceOrigin)) error('METADATA_REQUIRED', subject, 'sourceOrigin');
        if (isCommon && (!pair(c.faceAnchor) || c.faceAnchor.some((n, i) => n < 0 || n >= c.frameSize?.[i]))) error('METADATA_REQUIRED', subject, '실제 공통 faceAnchor 필요');
        const expectedFrames = isWestern ? 4 : isExpansion ? (definition.rarity === 'special' ? 16 : 4) : 5;
        if (c.frameCount !== expectedFrames || c.frames?.length !== expectedFrames || c.columns !== expectedFrames) error('ANIMATION_INVALID', subject, '본체는 5개 셀/5 columns 필요');
        if (typeof c.giant !== 'boolean' || c.giant !== (definition.presentation === 'giant')) error('MANIFEST_MISMATCH', subject, 'giant');
        if (c.giant) {
          if (!same(c.frameSize, [192, 256]) || !same(c.anchor, [0, 0]) || !same(c.contactPoint, [0, 0])) {
            error('MANIFEST_MISMATCH', subject, '거대 구도/원점 불일치');
          }
          if (!pair(definition.giant?.faceAnchor)) error('METADATA_REQUIRED', subject, 'giant.faceAnchor');
          if (isCommon && !same(c.giantDefinition, definition.giant)) error('MANIFEST_MISMATCH', subject, 'giantDefinition');
        }
        const l = layout.find(row => row.no === definition.no);
        if (l) {
          if (!same(l.contactPoint, c.contactPoint)) error('LAYOUT_MISMATCH', subject, 'contactPoint');
          const anchor = season === 'autumn' && pair(l.stillAnchor) && pair(c.sourceOrigin)
            ? l.stillAnchor.map((v, i) => v + c.sourceOrigin[i]) : l.anchor;
          if (!same(anchor, c.anchor)) error('LAYOUT_MISMATCH', subject, '가을 stillAnchor+sourceOrigin 또는 겨울 anchor');
        }
        const animationBase = `${base}/animation`;
        bodyPaths.push(...(c.frames ?? []).map(path => `${animationBase}/${path}`));
        const layers = array(c.layers ?? [], `${subject}.layers`).map(layer => {
          spatial(layer, `${subject}:${layer.type}`);
          const framePaths = layer.frames === undefined ? [] : array(layer.frames, `${subject}:${layer.type}.frames`);
          if (!layer.image && !framePaths.length && !layer.sheet) {
            error('LAYER_ASSET_REQUIRED', `${subject}:${layer.type}`, 'image / frames / sheet 중 실제 파일 참조 필요');
          }
          uniquePaths(framePaths, `${subject}:${layer.type}.frames`);
          if (layer.sequence || layer.durationsMs || layer.frames) playback(layer, `${subject}:${layer.type}`);
          if (layer.frames && layer.frames.length !== layer.frameCount) error('ANIMATION_INVALID', subject, `${layer.type} 프레임 수`);
          return { metadata: layer, usage: layer.type === 'foreground' ? 'map-foreground' :
            layer.type === 'support_icicle' ? 'included-in-map-scene' : 'original',
            image: layer.image ? local(animationBase, layer.image, layer.frameSize) : null,
            frames: framePaths.map(path => local(animationBase, path, layer.frameSize)),
            sheet: layer.sheet ? local(animationBase, layer.sheet, pair(layer.frameSize)
              ? [layer.frameSize[0] * layer.frameCount, layer.frameSize[1]] : null) : null };
        });
        art = { still: local(base, `pixel/${subject}.png`),
          animation: { source: manifestPath, metadata: isCommon && ['rock_left', 'bush_right'].includes(c.spot) ? { ...c, foregroundSpot: c.spot } : c,
            sheet: local(animationBase, c.sheet, pair(c.frameSize) ? [c.frameSize[0] * c.columns, c.frameSize[1]] : null),
            frames: array(c.frames, subject).map(path => local(animationBase, path, c.frameSize)),
            halo: c.haloImage ? local(animationBase, c.haloImage, [192, 256]) : null, layers },
          layout: l ?? null, layoutSource: l ? `${base}/layout.json` : null };
      }
      if (definition.mainItemId && definition.mainItemId !== id('item', definition.no)) error('ITEM_LINK_MISMATCH', subject, definition.mainItemId);
      yokai.push({ ...definition, legacyImage: isCommon ? null : definition.image, mainItemId: id('item', definition.no),
        definitionSource: definitionPath, definitionStatus: isCommon || (isWestern && definition.no<=94) ? 'common-json' : 'season-json', art });
    }
  }
  uniquePaths(bodyPaths, '본체 프레임');
  ids(yokai, numbers(1, 102).map(n => id('yokai', n)), '통합 요괴');
  for (const row of yokai) {
    const owned = items.filter(item => item.ownerYokaiId === row.id);
    if (owned.length !== 1 || owned[0]?.id !== row.mainItemId) error('OWNER_NOT_ONE_TO_ONE', row.id, owned.map(item => item.id).join(', '));
  }
  for (const item of items) if (!yokai.some(y => y.id === item.ownerYokaiId)) error('OWNER_NOT_ONE_TO_ONE', item.id, '소유 요괴 없음');

  const mapPath = `${BG}/map_manifest.json`, rawMaps = array(json(mapPath)?.maps, mapPath);
  const expectedMaps = ['forest', 'hill'].flatMap(family => Object.keys(SEASONS).map(season => `${family}_${season}`));
  ids(rawMaps, expectedMaps, mapPath);
  const combinations = rawMaps.map(m => `${m.family}_${m.season}`);
  if (new Set(combinations).size !== 8 || expectedMaps.some(key => !combinations.includes(key))) {
    error('MAP_COMBINATION_INVALID', mapPath, '숲/언덕 × 사계절은 고유 8조합이어야 함');
  }
  const maps = rawMaps.map(map => {
    if (map.id !== `${map.family}_${map.season}`) error('MAP_COMBINATION_INVALID', map.id, 'id와 family/season 불일치');
    if (!same(map.logicalSize, [192, 256]) || !same(map.displaySize, [384, 512])) error('METADATA_REQUIRED', map.id, '맵 크기');
    const adapter = typeof map.adapter === 'string' ? json(`${BG}/${map.adapter}`) : null;
    if (adapter?.mapId !== map.id) error('ADAPTER_MISMATCH', map.id, 'adapter.mapId');
    const layers = array(map.layers, map.id).map(layer => {
      required(layer, ['id', 'path', 'order', 'size'], map.id);
      const ref = local(BG, layer.path, [192, 256]);
      const expectedHash = map.layerHashes?.[layer.id];
      if (ref && expectedHash && ref.sha256 !== expectedHash) error('HASH_MISMATCH', map.id, layer.id);
      if (ref && layer.id === 'machine' && ref.sha256 !== map.machineHash) error('HASH_MISMATCH', map.id, 'machineHash');
      return { id: layer.id, order: layer.order, file: ref };
    });
    uniquePaths(layers.map(l => l.id), `${map.id} layer IDs`);
    for (const [key, spot] of Object.entries(map.spots ?? {})) {
      if (!pair(spot.contactPoint)) error('METADATA_REQUIRED', map.id, `${key}.contactPoint`);
      if (spot.foreground) {
        local(BG, spot.foreground, [192, 256]);
        if (spot.foreground !== adapter?.foreground?.[key]) error('ADAPTER_MISMATCH', map.id, `${key}.foreground`);
      }
    }
    for (const key of ['bush_right', 'rock_left']) if (!adapter?.foreground?.[key]) error('METADATA_REQUIRED', map.id, `foreground.${key}`);
    return { id: map.id, family: map.family, season: map.season, metadata: map, adapterMetadata: adapter,
      scene: local(BG, map.scene, [192, 256]), scene2x: local(BG, map.scene2x, [384, 512]), layers,
      foreground: Object.fromEntries(Object.entries(adapter?.foreground ?? {}).map(([key, path]) => [key, local(BG, path, [192, 256])])),
      supportProps: adapter?.supportProps ? local(BG, adapter.supportProps, [192, 256]) : null,
      skyMetadata: map.skyMetadata ? local(BG, map.skyMetadata) : null };
  });
  const compatibilityPath = `${BG}/adapters/placement_compatibility.json`;
  const compatibility = json(compatibilityPath);
  const defaults = array(compatibility?.verifiedDefaults, compatibilityPath);
  ids(defaults, numbers(21, 60), compatibilityPath, 'no');
  const commonDefaults = array(registration.verifiedDefaults, registrationPath);
  ids(commonDefaults.map(d => ({ id: `${d.no}:${d.season}` })), numbers(1, 20).flatMap(no => Object.keys(SEASONS).map(s => `${no}:${s}`)), registrationPath);
  const extraDefaults = array(extraRegistration.verifiedDefaults, extraRegistrationPath);
  ids(extraDefaults.map(d => ({ id: `${d.no}:${d.season}` })), numbers(61, 68).flatMap(no => Object.keys(SEASONS).map(s => `${no}:${s}`)), extraRegistrationPath);
  for (const ref of [...files.values()].filter(f => (f.sourcePath.startsWith(`${extraBase}/`) || f.sourcePath.startsWith('docs/아이템/추가/')) && f.sourcePath !== extraRegistrationPath)) {
    if (extraHashes[ref.sourcePath] !== ref.sha256) error('EXTRA_APPROVAL_STALE', ref.sourcePath, '추가 최종 파일 승인 해시 필요');
  }
  for (const ref of [...files.values()].filter(f => f.sourcePath.startsWith('docs/요괴/공통/') && f.sourcePath !== registrationPath)) {
    if (registeredHashes[ref.sourcePath] !== ref.sha256) error('COMMON_APPROVAL_STALE', ref.sourcePath, '현재 공통 최종 파일의 승인 해시 필요');
  }
  const expansionDefaults = array(json(`${expansionBase}/placements.json`), `${expansionBase}/placements.json`);
  ids(expansionDefaults, numbers(69, 92), `${expansionBase}/placements.json`, 'no');
  const westernDefaults = array(json(`${westernBase}/placements.json`), `${westernBase}/placements.json`);
  ids(westernDefaults.map(d => ({id:`${d.no}:${d.season}`})), numbers(93,102).flatMap(no => (no<=94 ? Object.keys(SEASONS) : [Object.keys(SEASONS)[Math.floor((no-95)/2)]]).map(s=>`${no}:${s}`)), `${westernBase}/placements.json`);
  for (const y of yokai.filter(y => y.art)) {
    const m = y.art.animation.metadata;
    for (const season of y.seasons) {
      const d = [...commonDefaults, ...defaults, ...extraDefaults, ...expansionDefaults, ...westernDefaults].find(d => d.no === y.no && d.season === season);
      if (!d || d.status !== 'verified_original_default' || !same(d.sourceAnchor, m.anchor) || !same(d.sourceContactPoint, m.contactPoint) ||
          !same(d.families, ['forest', 'hill'])) error('PLACEMENT_MISMATCH', y.id, `검증된 ${season} 기본 배치와 현재 manifest 불일치`);
    }
  }
  file(`${BG}/astronomy/sources.txt`);
  file(`${BG}/integration_notes.txt`); file('docs/아이템/integration_notes.txt');
  note('LEGACY_IMAGE_ALIAS', 'yokai_021~060', '기존 image=assets/yokai/...는 보존용 참조. 실제 정지 이미지는 해당 계절 pixel/, 재생은 animation/manifest 기준. mainItemId는 원본 변경 없이 앱 목록에 추가.');
  note('LATEST_ITEMS_OVERRIDE', 'item_001~060', 'items.json의 이름과 설명 및 원래 pixel/의 16×16 PNG를 등록.');
  note('OPTIONAL_LAYOUT', 'spring/summer', '별도 layout.json 없음. 현재 animation manifest의 좌표를 사용하며 누락 오류로 세지 않음.');
  note('LAYER_OVERRIDES', 'yokai_034/047/052/053', '034/047/052 전경은 현재 맵 adapter로 대체; 053 옛 고드름은 맵 scene에 포함. 원본 보조층은 보존·검사하되 중복 합성 금지.');
  note('PLACEMENT_RESTRICTIONS', compatibilityPath, '계절80조합과 별도 공통160조합의 기본 배치만 활성화. rejectedTypedTrials와 미검증 줄기/손 앵커는 비활성. 반픽셀 ties-to-even 유지.');
  note('COMMON_REGISTRATION', registrationPath, '공통 제작 정의/100셀/효과/얼굴 좌표와 4계절 배치 연결. 기획서 기본 weight=10, 기존 아이템001~020 보존.');
  const catalog = { version: 1, pathPolicy: 'sourcePath: project root; publicPath: Vite public root; BASE_URL prefix at runtime',
    yokai: yokai.sort((a, b) => a.no - b.no), items, maps, compatibility: { source: compatibilityPath, commonSource: registrationPath,
      extraSource: extraRegistrationPath, metadata: { ...compatibility, verifiedDefaults: [...defaults, ...commonDefaults, ...extraDefaults, ...expansionDefaults, ...westernDefaults] } },
    files: [...files.values()].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath, 'en')) };
  const summary = { yokai: yokai.length, items: items.length, maps: maps.length,
    missingYokaiArt: yokai.filter(y => !y.art).length,
    bodyFrames: yokai.reduce((count, y) => count + (y.art?.animation.frames.filter(Boolean).length ?? 0), 0),
    stills: yokai.filter(y => y.art?.still).length,
    itemIcons: items.filter(i => i.icon).length, files: files.size,
    errors: issues.filter(i => i.severity === 'error').length,
    missing: issues.filter(i => i.severity === 'missing').length, notes: issues.filter(i => i.severity === 'note').length };
  return { catalog, report: { version: 1, summary, issues,
    limits: ['파일 존재·SHA256·PNG 헤더 치수·정의 메타데이터 검사. 모든 픽셀의 시각 품질/PNG 전체 디코딩 검사가 아님.',
      '서버·개발 서버·브라우저 게임·합성·애니메이션 실제 재생 미검증(A03 이후).',
      '원본 제작 검증 스크립트는 실행하지 않음. 결과물을 다시 만드는 스크립트도 실행하지 않음.'] } };
}
