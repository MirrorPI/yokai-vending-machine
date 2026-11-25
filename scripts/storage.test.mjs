import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryDriver, createMemoryRepository } from '../src/storage/memory.ts';
import { createBrowserRepository, SAVE_KEY } from '../src/storage/browser.ts';

// Browser platform substitutes only: all decoding, commands and repository code are real.
class StorageFixture {
  values = new Map();
  failRead = false;
  failWrite = false;
  failKeys = new Set();
  writes = [];
  getItem(key) {
    if (this.failRead) throw new DOMException('blocked', 'SecurityError');
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    if (this.failWrite || this.failKeys.has(key)) throw new DOMException('full', 'QuotaExceededError');
    this.writes.push([key, value]);
    this.values.set(key, value);
  }
}
class LocksFixture {
  tail = Promise.resolve();
  request(name, options, work) {
    assert.equal(name, `${SAVE_KEY}:writer`);
    assert.equal(options.mode, 'exclusive');
    const result = this.tail.then(() => work({ name, mode: 'exclusive' }));
    this.tail = result.catch(() => {});
    return result;
  }
}
function browser(seed) {
  const storage = new StorageFixture();
  if (seed !== undefined) storage.values.set(SAVE_KEY, seed);
  const locks = new LocksFixture();
  const reopen = () => createBrowserRepository({ storage: () => storage, locks: () => locks });
  return { repo: reopen(), reopen, storage, locks };
}
function memory(seed) {
  const base = createMemoryDriver(seed);
  const faults = { failRead: false, failWrite: false };
  // Inject storage I/O failures below the real repository and memory queue.
  const driver = { ...base, exclusive: work => base.exclusive(storage => work({
    getItem(key) {
      if (faults.failRead) throw new DOMException('blocked', 'SecurityError');
      return storage.getItem(key);
    },
    setItem(key, value) {
      if (faults.failWrite) throw new DOMException('full', 'QuotaExceededError');
      storage.setItem(key, value);
    },
  })) };
  const reopen = () => createMemoryRepository(driver);
  return { repo: reopen(), reopen, storage: faults };
}
const at = '2026-10-26T00:00:00.000Z';
const later = '2026-10-26T00:00:01.000Z';
const owner = { sessionId: 'tab-1', epoch: 1 };
const visit = (id = 'visit-1') => ({
  visitId: id, yokaiId: 'yokai_001', itemId: 'item_001', appearedAt: at,
  captureDeadlineAt: '2026-10-26T00:00:20.000Z', season: 'autumn', backgroundFamily: 'forest',
});
const claim = { type: 'claimObservation', sessionId: 'tab-1', expectedEpoch: 0 };
const start = (id) => ({ type: 'startVisit', owner, visit: visit(id) });
const settle = (id = 'visit-1', source = 'manual') => ({
  type: 'settleVisit', owner, visitId: id, source, at: later,
  ...(source === 'manual' ? { photo: { photoKey: 'yokai_001_autumn' } } : {}),
});
function state(result, status = 'applied') {
  assert.equal(result.status, status, JSON.stringify(result));
  return result.state;
}
async function captured(repo) {
  state(await repo.commit(claim));
  state(await repo.commit(start()));
  return state(await repo.commit(settle()));
}

for (const [name, setup, persistence] of [
  ['memory', memory, 'volatile'], ['browser', browser, 'local'],
]) {
  test(`${name}: 정상 빈 저장과 조회 사본의 독립성`, async () => {
    const { repo } = setup();
    const result = await repo.read();
    const current = state(result, 'ok');
    assert.equal(result.origin, 'empty');
    assert.equal(result.persistence, persistence);
    assert.deepEqual(current, {
      version: 3, revision: 0, firstRunDone: false, discovered: {}, items: {},
      activeVisit: null, lastSettlement: null, observationOwner: null,
      settings: { sound: false, arrivalChime: false, backgroundFamily: 'forest' },
    });
    current.settings.sound = true;
    assert.equal(state(await repo.read(), 'ok').settings.sound, false);
  });
  test(`${name}: 재조회와 같은 저장 기반의 어댑터 재생성으로 복구`, async () => {
    const { repo, reopen } = setup();
    const changed = state(await repo.commit({ type: 'changeSettings', patch: { sound: true } }));
    assert.equal(changed.revision, 1);
    assert.equal(state(await reopen().read(), 'ok').settings.sound, true);
    assert.equal(state(await repo.read(), 'ok').revision, 1);
  });
  test(`${name}: 오래된 revision을 거부하고 실패한 명령은 변경하지 않는다`, async () => {
    const { repo } = setup();
    state(await repo.commit({ type: 'changeSettings', patch: { sound: true } }, { expectedRevision: 0 }));
    const conflict = await repo.commit({ type: 'changeSettings', patch: { arrivalChime: true } }, { expectedRevision: 0 });
    assert.equal(conflict.status, 'conflict');
    assert.equal(conflict.actualRevision, 1);
    assert.equal((await repo.commit({ type: 'changeSettings', patch: { sound: 'yes' } })).status, 'invalid');
    assert.equal(state(await repo.read(), 'ok').settings.arrivalChime, false);
    assert.equal(state(await repo.read(), 'ok').revision, 1);
  });
  test(`${name}: 여러 인스턴스의 동시 변경은 최신 상태에 병합`, async () => {
    const { repo, reopen } = setup();
    const other = reopen();
    const results = await Promise.all([
      repo.commit({ type: 'changeSettings', patch: { sound: true } }),
      other.commit({ type: 'changeSettings', patch: { arrivalChime: true } }),
    ]);
    results.forEach(r => state(r));
    const saved = state(await other.read(), 'ok');
    assert.equal(saved.revision, 2);
    assert.equal(saved.settings.sound, true);
    assert.equal(saved.settings.arrivalChime, true);
    const raced = await Promise.all([
      repo.commit({ type: 'changeSettings', patch: { sound: false } }, { expectedRevision: 2 }),
      other.commit({ type: 'changeSettings', patch: { arrivalChime: false } }, { expectedRevision: 2 }),
    ]);
    assert.deepEqual(raced.map(r => r.status).sort(), ['applied', 'conflict']);
  });
  test(`${name}: 정산은 물건·촬영·사진 예약·지급 표시를 함께 확정`, async () => {
    const { repo, reopen } = setup();
    const saved = await captured(repo);
    assert.equal(saved.revision, 3);
    assert.deepEqual(saved.items.item_001, {
      totalCount: 1, manualCount: 1, leftCount: 0, unreadCount: 1, unreadLeftCount: 0,
      firstObtainedAt: later, lastObtainedAt: later, firstViewedAt: null,
    });
    assert.equal(saved.discovered.yokai_001.captureCount, 1);
    assert.equal(saved.discovered.yokai_001.coverSeason, 'autumn');
    assert.equal(saved.discovered.yokai_001.photos.autumn.status, 'pending');
    assert.equal(saved.activeVisit.itemGranted, true);
    assert.equal(saved.lastSettlement.visitId, 'visit-1');
    assert.deepEqual(state(await reopen().read(), 'ok'), saved);
    state(await repo.commit(settle()), 'unchanged');
    assert.equal(state(await repo.read(), 'ok').items.item_001.totalCount, 1);
  });
  test(`${name}: 실제 방문 1건 제한·epoch 검증·과거 방문 거부`, async () => {
    const { repo } = setup();
    state(await repo.commit(claim));
    state(await repo.commit(start()));
    assert.equal((await repo.commit(start('visit-2'))).status, 'invalid');
    assert.equal((await repo.commit(settle('not-active'))).status, 'invalid');
    state(await repo.commit({ type: 'claimObservation', sessionId: 'tab-2', expectedEpoch: 1 }));
    assert.equal((await repo.commit(settle())).status, 'invalid');
    const newOwner = { sessionId: 'tab-2', epoch: 2 };
    state(await repo.commit({ ...settle(), owner: newOwner }));
    state(await repo.commit({ type: 'finishVisit', owner: newOwner, visitId: 'visit-1' }));
    assert.equal((await repo.commit({ ...settle(), owner: newOwner })).status, 'invalid');
    assert.equal(state(await repo.read(), 'ok').items.item_001.totalCount, 1);
  });
  test(`${name}: 직접 정산 기한과 자동 정산의 기록 분리`, async () => {
    const { repo } = setup();
    state(await repo.commit(claim));
    state(await repo.commit(start()));
    assert.equal((await repo.commit({ ...settle(), at: visit().captureDeadlineAt })).status, 'invalid');
    const saved = state(await repo.commit(settle('visit-1', 'left')));
    assert.equal(saved.items.item_001.leftCount, 1);
    assert.equal(saved.items.item_001.unreadLeftCount, 1);
    assert.deepEqual(saved.discovered, {});
  });
  test(`${name}: 표시 범위 읽음 재시도와 새 증가분을 출처별로 병합`, async () => {
    const { repo } = setup();
    await captured(repo);
    state(await repo.commit({ type: 'finishVisit', owner, visitId: 'visit-1' }));
    state(await repo.commit(start('visit-2')));
    state(await repo.commit(settle('visit-2', 'left')));
    const viewed = { type: 'markItemViewed', itemId: 'item_001', viewedAt: later, manualCount: 1, leftCount: 0 };
    const saved = state(await repo.commit(viewed));
    assert.equal(saved.items.item_001.unreadCount, 1);
    assert.equal(saved.items.item_001.unreadLeftCount, 1);
    state(await repo.commit(viewed), 'unchanged');
    assert.equal((await repo.commit({ ...viewed, leftCount: 9 })).status, 'invalid');
    assert.equal(state(await repo.read(), 'ok').items.item_001.totalCount, 2);
  });
  test(`${name}: 사진 실패·지연 콜백은 촬영/물건/대표를 되돌리지 않는다`, async () => {
    const { repo } = setup();
    await captured(repo);
    state(await repo.commit({ type: 'changeSettings', patch: { backgroundFamily: 'hill' } }));
    const command = { type: 'updatePhotoStatus', yokaiId: 'yokai_001', season: 'autumn', photoKey: 'yokai_001_autumn', attemptId: 'visit-1', status: 'failed' };
    const saved = state(await repo.commit(command));
    assert.equal(saved.discovered.yokai_001.photos.autumn.status, 'failed');
    assert.equal(saved.discovered.yokai_001.captureCount, 1);
    assert.equal(saved.items.item_001.totalCount, 1);
    assert.equal(saved.settings.backgroundFamily, 'hill');
    assert.equal((await repo.commit({ ...command, photoKey: 'stale', status: 'saved' })).status, 'invalid');
    assert.equal((await repo.commit({ ...command, status: 'saved' })).status, 'invalid');
    state(await repo.commit(command), 'unchanged');
  });
  for (const version of [1, 2]) {
    test(`${name}: v${version} 이전은 사진·대표·설정·확장·미정의 ID를 보존하고 소급 지급하지 않는다`, async () => {
      const old = legacy(version);
      const { repo, reopen } = setup(JSON.stringify(old));
      const result = await repo.read();
      const saved = state(result, 'ok');
      assert.equal(result.origin, 'migrated');
      assert.equal(saved.version, 3);
      assert.equal(saved.revision, 1);
      assert.equal(saved.discovered.yokai_999.captureCount, 12);
      assert.equal(saved.discovered.yokai_999.photos.autumn.photoKey, 'original-key');
      assert.equal(saved.discovered.yokai_999.coverSeason, 'autumn');
      assert.deepEqual(saved.extra, { untouched: [1, 2] });
      assert.deepEqual(saved.settings.custom, { value: true });
      assert.deepEqual(saved.discovered.yokai_999.photos.autumn.extraPhoto, ['keep']);
      assert.equal(saved.settings.backgroundFamily, 'forest');
      assert.equal(saved.firstRunDone, true);
      assert.deepEqual(saved.items, {});
      assert.equal(saved.activeVisit, null);
      assert.deepEqual(state(await reopen().read(), 'ok'), saved);
      state(await repo.commit({ type: 'changeSettings', patch: { sound: false } }));
      assert.equal(state(await repo.read(), 'ok').discovered.yokai_999.extraCapture, 'keep');
    });
  }
  test(`${name}: v1의 photos 누락을 보완하고 기존 도감 횟수를 유지`, async () => {
    const old = legacy(1);
    delete old.discovered.yokai_999.photos;
    old.discovered.yokai_999.coverSeason = null;
    const { repo } = setup(JSON.stringify(old));
    const saved = state(await repo.read(), 'ok');
    assert.deepEqual(saved.discovered.yokai_999.photos, {});
    assert.equal(saved.discovered.yokai_999.captureCount, 12);
  });
  test(`${name}: v3의 미정의 물건·필드는 정상 변경 뒤에도 유지`, async () => {
    const seed = state(await setup().repo.read(), 'ok');
    seed.items.item_999 = {
      totalCount: 2, manualCount: 0, leftCount: 2, unreadCount: 2, unreadLeftCount: 2,
      firstObtainedAt: at, lastObtainedAt: at, firstViewedAt: null, unknown: { x: 1 },
    };
    seed.extra = { ignoredByUi: true };
    const { repo } = setup(JSON.stringify(seed));
    const saved = state(await repo.commit({ type: 'changeSettings', patch: { sound: true } }));
    assert.deepEqual(saved.items.item_999, seed.items.item_999);
    assert.deepEqual(saved.extra, seed.extra);
  });
  test(`${name}: 손상·미래 버전을 빈 저장이나 성공으로 처리하지 않는다`, async () => {
    for (const raw of ['', '{broken', 'null', '[]', '{"version":3}', JSON.stringify({ ...legacy(2), version: 10 })]) {
      const { repo } = setup(raw);
      const expected = raw.includes('"version":10') ? 'unsupported-version' : 'corrupt';
      assert.equal((await repo.read()).status, expected);
      assert.equal((await repo.commit(claim)).status, expected);
    }
  });
  test(`${name}: 사진 재예약 뒤 같은 키의 옛 콜백을 차단하고 대표와 저장 사진을 유지`, async () => {
    const { repo } = setup();
    await captured(repo);
    const callback = { type: 'updatePhotoStatus', yokaiId: 'yokai_001', season: 'autumn', photoKey: 'yokai_001_autumn', attemptId: 'visit-1', status: 'failed' };
    state(await repo.commit(callback));
    state(await repo.commit({ type: 'finishVisit', owner, visitId: 'visit-1' }));
    state(await repo.commit(start('visit-2')));
    state(await repo.commit(settle('visit-2')));
    assert.equal((await repo.commit({ ...callback, status: 'saved' })).status, 'invalid');
    state(await repo.commit({ ...callback, attemptId: 'visit-2', status: 'saved' }));
    const before = state(await repo.read(), 'ok').discovered.yokai_001.photos.autumn;
    state(await repo.commit({ type: 'finishVisit', owner, visitId: 'visit-2' }));
    state(await repo.commit(start('visit-3')));
    const after = state(await repo.commit(settle('visit-3')));
    assert.deepEqual(after.discovered.yokai_001.photos.autumn, before);
    assert.equal(after.discovered.yokai_001.captureCount, 3);
    assert.equal(after.discovered.yokai_001.coverSeason, 'autumn');
    assert.equal(after.items.item_001.totalCount, 3);
  });
  test(`${name}: 사진 완료·읽음·새 지급·설정의 동시 변경에 유실 없음`, async () => {
    const { repo, reopen } = setup();
    await captured(repo);
    state(await repo.commit({ type: 'finishVisit', owner, visitId: 'visit-1' }));
    state(await repo.commit(start('visit-2')));
    const other = reopen();
    const changes = await Promise.all([
      repo.commit(settle('visit-2', 'left')),
      other.commit({ type: 'markItemViewed', itemId: 'item_001', viewedAt: later, manualCount: 1, leftCount: 0 }),
      repo.commit({ type: 'updatePhotoStatus', yokaiId: 'yokai_001', season: 'autumn', photoKey: 'yokai_001_autumn', attemptId: 'visit-1', status: 'saved' }),
      other.commit({ type: 'changeSettings', patch: { sound: true } }),
    ]);
    changes.forEach(r => state(r));
    const saved = state(await repo.read(), 'ok');
    assert.equal(saved.items.item_001.totalCount, 2);
    assert.equal(saved.items.item_001.unreadCount, 1);
    assert.equal(saved.items.item_001.unreadLeftCount, 1);
    assert.equal(saved.discovered.yokai_001.photos.autumn.status, 'saved');
    assert.equal(saved.settings.sound, true);
  });
  test(`${name}: 큐에 넣은 명령을 호출자가 바꾸어도 저장 요청은 변하지 않음`, async () => {
    const { repo } = setup();
    const command = { type: 'changeSettings', patch: { sound: true } };
    const pending = repo.commit(command);
    command.patch.sound = false;
    assert.equal(state(await pending).settings.sound, true);
  });
  test(`${name}: 상충하는 지급 증빙은 손상 처리하며 추측 지급하지 않음`, async () => {
    const { repo } = setup();
    const saved = await captured(repo);
    for (const damage of [
      s => { s.activeVisit.itemGranted = false; s.activeVisit.state = 'VISITING'; s.activeVisit.grantSource = null; s.activeVisit.settledAt = null; },
      s => { s.items = {}; },
      s => { s.discovered = {}; },
      s => { s.discovered.yokai_001.photos = {}; s.discovered.yokai_001.coverSeason = null; },
    ]) {
      const broken = structuredClone(saved);
      damage(broken);
      const damaged = setup(JSON.stringify(broken)).repo;
      assert.equal((await damaged.read()).status, 'corrupt');
      assert.equal((await damaged.commit(settle())).status, 'corrupt');
    }
  });
  test(`${name}: 안전 정수 초과·미확인 출처 불변식 위반·준비 후보를 거부`, async () => {
    const fresh = state(await setup().repo.read(), 'ok');
    fresh.revision = Number.MAX_SAFE_INTEGER;
    const exhausted = setup(JSON.stringify(fresh)).repo;
    assert.equal((await exhausted.commit(claim)).status, 'invalid');
    const { repo } = setup();
    state(await repo.commit(claim));
    const candidate = start();
    delete candidate.visit.appearedAt;
    assert.equal((await repo.commit(candidate)).status, 'invalid');
    const saved = await captured(setup().repo);
    saved.items.item_001.unreadLeftCount = 1;
    assert.equal((await setup(JSON.stringify(saved)).repo.read()).status, 'corrupt');
  });
  test(`${name}: 같은 실패 계약으로 미정산 유지·재시도·읽기 실패를 검증`, async () => {
    const { repo, reopen, storage } = setup();
    state(await repo.commit(claim));
    state(await repo.commit(start()));
    storage.failWrite = true;
    const failure = await repo.commit(settle());
    assert.equal(failure.status, 'unavailable');
    assert.equal(failure.operation, 'write');
    storage.failWrite = false;
    const uncommitted = state(await reopen().read(), 'ok');
    assert.equal(uncommitted.revision, 2);
    assert.equal(uncommitted.activeVisit.itemGranted, false);
    assert.deepEqual(uncommitted.items, {});
    assert.deepEqual(uncommitted.discovered, {});
    state(await repo.commit(settle()));
    state(await reopen().commit(settle()), 'unchanged');
    assert.equal(state(await repo.read(), 'ok').items.item_001.totalCount, 1);
    storage.failRead = true;
    assert.equal((await repo.read()).operation, 'read');
    assert.equal((await repo.commit(claim)).status, 'unavailable');
  });
  test(`${name}: 방문 정리 뒤에도 마지막 정산의 물건·출처 증빙이 없으면 원문을 보호`, async () => {
    const { repo } = setup();
    await captured(repo);
    state(await repo.commit({ type: 'finishVisit', owner, visitId: 'visit-1' }));
    const finished = state(await repo.read(), 'ok');
    state(await repo.commit(start('visit-2')));
    const next = state(await repo.read(), 'ok');
    for (const seed of [finished, next]) {
      for (const damage of [
        s => { s.items = {}; },
        s => { Object.assign(s.items.item_001, { manualCount: 0, leftCount: 1, unreadLeftCount: 1 }); },
      ]) {
        const broken = structuredClone(seed);
        damage(broken);
        const bad = setup(JSON.stringify(broken)).repo;
        assert.equal((await bad.read()).status, 'corrupt');
        assert.equal((await bad.commit({ type: 'changeSettings', patch: { sound: true } })).status, 'corrupt');
      }
    }
  });
}

function legacy(version) {
  return {
    version, firstRunDone: true,
    discovered: { yokai_999: {
      firstCapturedAt: at, captureCount: 12, coverSeason: 'autumn', extraCapture: 'keep',
      photos: { autumn: { photoKey: 'original-key', at, extraPhoto: ['keep'] } },
    } },
    settings: { sound: true, arrivalChime: true, backgroundFamily: 'invalid-old-value', custom: { value: true } },
    extra: { untouched: [1, 2] },
    activeVisit: { visitId: 'uncertain', itemGranted: false },
  };
}

test('browser: 정산은 단일 스냅샷 쓰기이며 실패 시 전체가 미적용', async () => {
  const { repo, storage, reopen } = browser();
  state(await repo.commit(claim));
  state(await repo.commit(start()));
  const before = storage.values.get(SAVE_KEY);
  storage.failWrite = true;
  const failed = await repo.commit(settle());
  assert.equal(failed.status, 'unavailable');
  assert.equal(failed.operation, 'write');
  assert.equal(storage.values.get(SAVE_KEY), before);
  storage.failWrite = false;
  assert.equal(state(await reopen().read(), 'ok').activeVisit.itemGranted, false);
  const count = storage.writes.length;
  state(await repo.commit(settle()));
  assert.equal(storage.writes.length, count + 1);
  assert.equal(state(await reopen().read(), 'ok').items.item_001.totalCount, 1);
});
test('browser: 저장 차단·읽기 실패·잠금 미지원은 정상 빈 저장과 구분', async () => {
  const { repo, storage } = browser();
  storage.failRead = true;
  assert.equal((await repo.read()).operation, 'read');
  assert.equal((await repo.commit(claim)).status, 'unavailable');
  const blocked = createBrowserRepository({ storage: () => { throw new DOMException('blocked', 'SecurityError'); }, locks: () => new LocksFixture() });
  assert.equal((await blocked.read()).status, 'unavailable');
  const noLocks = createBrowserRepository({ storage: () => storage, locks: () => undefined });
  assert.equal((await noLocks.commit(claim)).operation, 'lock');
});
test('browser: 이전 원문 백업·이전 재시도와 중단 실패 보존', async () => {
  const raw = JSON.stringify(legacy(2));
  const { repo, storage, reopen } = browser(raw);
  storage.failWrite = true;
  assert.equal((await repo.read()).status, 'unavailable');
  assert.equal(storage.values.get(SAVE_KEY), raw);
  storage.failWrite = false;
  state(await repo.read(), 'ok');
  assert.equal(storage.values.get(`${SAVE_KEY}.v2`), raw);
  const writes = storage.writes.length;
  state(await reopen().read(), 'ok');
  assert.equal(storage.writes.length, writes);
  assert.equal(storage.values.get(`${SAVE_KEY}.v2`), raw);
});
test('browser: 손상 원문 백업을 덮어쓰지 않으며 안전한 필드만 읽기 전용 복구', async () => {
  const healthy = state(await browser().repo.read(), 'ok');
  healthy.discovered = legacy(2).discovered;
  healthy.items.item_bad = { totalCount: 99, manualCount: 1, leftCount: 1 };
  healthy.activeVisit = { visitId: 'unknown-payout', itemGranted: 'maybe' };
  const raw = JSON.stringify(healthy);
  const { repo, storage } = browser(raw);
  storage.values.set(`${SAVE_KEY}.corrupt`, 'earlier original');
  const result = await repo.read();
  assert.equal(result.status, 'corrupt');
  assert.equal(result.backup, 'saved');
  assert.equal(result.recovered.discovered.yokai_999.photos.autumn.photoKey, 'original-key');
  assert.equal(result.recovered.activeVisit, null);
  assert.deepEqual(result.recovered.items, {});
  assert.equal(storage.values.get(SAVE_KEY), raw);
  assert.equal(storage.values.get(`${SAVE_KEY}.corrupt`), 'earlier original');
  assert.ok([...storage.values.values()].includes(raw));
  assert.equal((await repo.commit(claim)).status, 'corrupt');
  storage.failWrite = true;
  storage.values.set(SAVE_KEY, '{another broken');
  assert.equal((await repo.read()).backup, 'failed');
});
test('browser: 백업 성공 뒤 이전 커밋 실패도 원문을 유지하고 정확히 한 번 이전', async () => {
  const raw = JSON.stringify(legacy(2));
  const { repo, storage, reopen } = browser(raw);
  storage.failKeys.add(SAVE_KEY);
  const result = await repo.read();
  assert.equal(result.status, 'unavailable');
  assert.equal(result.operation, 'write');
  assert.equal(storage.values.get(SAVE_KEY), raw);
  assert.equal(storage.values.get(`${SAVE_KEY}.v2`), raw);
  storage.failKeys.clear();
  const migrated = state(await reopen().read(), 'ok');
  assert.equal(migrated.revision, 1);
  assert.deepEqual(migrated.items, {});
  assert.deepEqual(state(await repo.read(), 'ok'), migrated);
});
test('메모리와 브라우저의 동일 명령열은 영속성 표시 외 같은 결과', async () => {
  const a = memory().repo;
  const b = browser().repo;
  for (const command of [
    claim, start(), settle(), settle(),
    { type: 'markItemViewed', itemId: 'item_001', viewedAt: later, manualCount: 1, leftCount: 0 },
    { type: 'updatePhotoStatus', yokaiId: 'yokai_001', season: 'autumn', photoKey: 'yokai_001_autumn', attemptId: 'visit-1', status: 'saved' },
    { type: 'changeSettings', patch: { sound: true } },
    { type: 'finishVisit', owner, visitId: 'visit-1' },
    settle(), start('visit-2'), settle('visit-2', 'left'),
  ]) {
    const { persistence: _a, ...ra } = await a.commit(command);
    const { persistence: _b, ...rb } = await b.commit(command);
    assert.deepEqual(ra, rb);
  }
});
