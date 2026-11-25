import { IntroCutscene } from '../onboarding/IntroCutscene.tsx';
import { useGameAudio } from '../audio/context.tsx';
import { AccountSettings } from '../account/AccountSettings.tsx';
import { useSurface } from '../observation/context.tsx';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SettingsController } from './controller.ts';
import { installPanelBehavior } from '../encyclopedia/panel.ts';
export interface EnvironmentStatus { requested: string | null; displayed: string | null; status: string; retry(): void }
const familyName = (family: string | null) => family === 'hill' ? '별이 보이는 언덕' : family === 'forest' ? '숲속' : '준비 중';
export function SettingsPanel({ controller, environment, onClose }: {
  controller: SettingsController; environment: EnvironmentStatus | null; onClose(): void;
}) {
  const [replay, setReplay] = useState(false);
  const replayTrigger = useRef<HTMLButtonElement>(null);
  const audio = useGameAudio();
  const { host, generation } = useSurface();
  const s = useSyncExternalStore(controller.subscribe, () => controller.snapshot);
  const endReplay = () => { setReplay(false); requestAnimationFrame(() => replayTrigger.current?.focus()); };
  const dialog = useRef<HTMLElement>(null), close = useRef(onClose); close.current = replay ? endReplay : onClose;
  useEffect(() => { if (!replay) return installPanelBehavior({ dialog: dialog.current!, onClose: () => close.current() }); }, [generation, replay]);
  return <div className="encyclopedia-backdrop settings-backdrop" data-capture-blocker onPointerDown={e => e.stopPropagation()}
    onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
    <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="settings-title" className="encyclopedia-panel settings-panel">
      <header className="encyclopedia-header" hidden={replay}><h2 id="settings-title">설정</h2><button onClick={onClose} aria-label="설정 닫기">닫기</button></header>
      <div className="encyclopedia-scroll settings-scroll" hidden={replay}>
        <h3>컷신 모음</h3>
        <p>숲속에서 시작된 작은 이야기들을 다시 만나 보세요.</p>
        <button ref={replayTrigger} onClick={() => setReplay(true)}>첫 이야기 · 숲속의 자판기 <span aria-hidden="true">▷</span></button>
        <p className="encyclopedia-muted">5장면 · 약 11초 · 화면을 눌러 넘기기</p>
        {s.settings && <>
          <h3>소리</h3><p>처음에는 무음이에요. 원하는 소리만 켜 주세요.</p>
          {([['sound', '배경 음악'], ['arrivalChime', '요괴 등장 알림음']] as const).map(([key,label]) => <div className="settings-sound-row" key={key}>
            <span>{label}</span><button role="switch" aria-checked={s.settings![key]} aria-label={label} onClick={() => {
              const next = { ...s.settings!, [key]: !s.settings![key] };
              audio?.configure(next); void audio?.unlock(); controller.change({ [key]: next[key] });
            }}>{s.settings![key] ? '켜짐' : '꺼짐'}</button>
          </div>)}
          <p className="encyclopedia-muted">잔잔한 종소리 음악 · 소리를 켠 설정은 기억해요.</p>
          <h3>환경</h3><div className="settings-options">{(['forest', 'hill'] as const).map(f => <button key={f} aria-pressed={s.settings!.backgroundFamily === f}
            onClick={() => controller.change({ backgroundFamily: f })}>{familyName(f)}</button>)}</div>
          <p>저장 환경: {familyName(s.state?.settings.backgroundFamily ?? null)}</p>
          <p>요청 환경: {familyName(environment?.requested ?? null)} · 현재 장면: {familyName(environment?.displayed ?? null)}</p>
          <p>손님이 머무는 동안에는 마지막 선택을 기억하고, 방문이 끝나면 장면을 바꿔요.</p>
          {environment?.status === 'failed' && <><p role="status">장면 로드 실패 · 기존 장면을 유지해요.</p><button onClick={environment.retry}>장면 다시 불러오기</button></>}
        </>}
        <p role="status">{s.phase === 'error' ? s.error : s.phase === 'saving' ? '설정 저장 중…' : s.phase === 'ready' ? '설정 저장 확인됨' : '설정 조회 중…'}</p>
        {s.phase === 'error' && <button onClick={() => { void controller.retry(); }}>설정 다시 시도</button>}
        <h3>작은 창</h3><p>{host?.pip.available ? '메인 화면의 작게 띄우기로 같은 게임을 옮길 수 있어요. 원래 탭을 닫으면 작은 창도 닫혀요.' : '이 브라우저는 작은 창을 지원하지 않아요. 창을 줄여서 구석에 두세요.'}</p>
        <AccountSettings/>
      </div>
      {replay && <IntroCutscene replay onFinish={endReplay}/> }
    </section>
  </div>;
}
