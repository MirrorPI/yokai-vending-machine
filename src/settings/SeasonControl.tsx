import { useSyncExternalStore } from 'react';
import { chosenSeason, seasonProgress } from '../domain/season-control.ts';
import type { Season } from '../domain/state.ts';
import type { SettingsController } from './controller.ts';
import './season-control.css';
const names = { spring: '봄', summer: '여름', autumn: '가을', winter: '겨울' };
export function SeasonControl({ controller }: { controller: SettingsController }) {
  const snapshot = useSyncExternalStore(controller.subscribe, () => controller.snapshot, () => controller.snapshot);
  const progress = seasonProgress(snapshot.state);
  const selected = chosenSeason(snapshot.state);
  return <details className="season-control" data-capture-blocker onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
    <summary aria-label={progress.unlocked ? "계절 선택" : `계절 선택 잠김 · ${progress.captured}/${progress.required}종 촬영`}>계절</summary>
    <div className="season-control-menu">
      <strong>계절의 문</strong>
      <p>{progress.unlocked ? '원하는 계절에 머물러 보세요.' : '도감에 서로 다른 요괴 50종을 촬영해 등록하면 계절 고정이 열려요.'}</p>
      <button aria-pressed={!selected} disabled={!snapshot.state || snapshot.phase === 'saving'} onClick={() => controller.change({ seasonMode: 'auto' })}>자동 순환</button>
      <fieldset className={`season-control-group${progress.unlocked ? '' : ' season-control-group--locked'}`} aria-label="계절 고르기">
        {!progress.unlocked && <legend title={`도감에 촬영한 서로 다른 요괴 수: ${progress.captured} / ${progress.required}종`} aria-label={`도감에 서로 다른 요괴 ${progress.captured}종 촬영, ${progress.required}종에 잠금 해제`}>
          <span className="season-control-progress"><svg className="season-lock" viewBox="0 0 20 22" aria-hidden="true"><path d="M5 9V6a5 5 0 0 1 10 0v3"/><rect x="2" y="9" width="16" height="11" rx="2"/><path d="M10 13v3"/></svg><span>계절 고정 해금<br/>{progress.captured} / {progress.required}종 촬영</span></span>
        </legend>}
        <div className="season-control-options">{(Object.keys(names) as Season[]).map(season => <button key={season} data-season={season} aria-pressed={selected === season}
          disabled={!progress.unlocked || snapshot.phase === 'saving'} onClick={() => controller.change({ seasonMode: 'fixed', fixedSeason: season })}>{names[season]}</button>)}</div>
      </fieldset>
      <small>{selected ? '선택한 계절에 고정돼요. 자동 순환으로 돌아갈 수 있어요.' : '봄 → 여름 → 가을 → 겨울 순서로 흘러가요.'}</small>
      <small>손님이 있다면 방문이 끝난 뒤 바뀌어요.</small>
    </div>
  </details>;
}
