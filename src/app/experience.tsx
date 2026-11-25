import { GameAudio } from '../audio/player.ts';
import { AudioContext } from '../audio/context.tsx';
import { useAccount } from '../account/context.tsx';
import { PipControls, useSurface } from '../observation/context.tsx';
import { OnboardingNotice } from '../onboarding/OnboardingNotice.tsx';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createBrowserRepository } from '../storage/browser.ts';
import { subscribeSurfaceChanges } from '../observation/changes.ts';
import { SettingsController } from '../settings/controller.ts';
import { OnboardingController } from '../onboarding/controller.ts';
import type { EnvironmentStatus } from '../settings/SettingsPanel.tsx';
import { RuntimeStage } from '../runtime/RuntimeStage.tsx';
import { Collections } from './collections.tsx';
import type { CollectionDisplay } from './collection-layout.ts';
import { hasSeenIntro, introCutsceneId } from '../onboarding/cutscene.ts';
import { FirstVisitIntro } from '../onboarding/FirstVisitIntro.tsx';
import type { Season } from '../domain/state.ts';
import { isLocalCollectionTest } from '../runtime/local-collection-test.ts';
import { SeasonControl } from '../settings/SeasonControl.tsx';
export function OrdinaryExperience({ scale, collectionDisplay, onSceneSeason }: {
  scale: number; collectionDisplay: CollectionDisplay; onSceneSeason(season: Season): void;
}) {
  const { host } = useSurface();
  const account = useAccount(), ports = account?.ports;
  const localTest = import.meta.env.DEV && isLocalCollectionTest({development:true,hostname:location.hostname,search:location.search,apiBaseUrl:account?.session.config.apiBaseUrl,accountKey:ports?.accountKey});
  const introAccount = ports?.accountKey ?? 'guest';
  const [seenAccounts, setSeenAccounts] = useState<ReadonlySet<string>>(() => new Set());
  const settings = useMemo(() => new SettingsController({ repository: ports?.repository ?? createBrowserRepository(), subscribeChanges: ports?.subscribeChanges ?? (changed => host ? subscribeSurfaceChanges(host.surfaces, changed) : () => {}) }), [host, ports]);
  const s = useSyncExternalStore(settings.subscribe, () => settings.snapshot);
  const introDone = localTest || seenAccounts.has(introAccount) || hasSeenIntro(s.state);
  const onboarding = useMemo(() => new OnboardingController(() => settings.completeTutorial()), [settings]);
  const [audio, setAudio] = useState<GameAudio | null>(null);
  useEffect(() => { const player = new GameAudio(); setAudio(player); return () => player.dispose(); }, [ports]);
  useEffect(() => {
    if (!audio) return;
    const update = () => audio.configure(settings.snapshot.settings ?? { sound: false, arrivalChime: false });
    update(); return settings.subscribe(update);
  }, [audio, settings]);
  useEffect(() => {
    if (!audio) return;
    let detach = () => {};
    const bind = () => {
      detach();
      const doc = host?.surfaces.document ?? document;
      audio.setVisible(introDone && (host?.surfaces.observable() ?? doc.visibilityState === 'visible'));
      const unlock = () => { void audio.unlock(); };
      doc.addEventListener('pointerdown', unlock, true); doc.addEventListener('keydown', unlock, true);
      detach = () => { doc.removeEventListener('pointerdown', unlock, true); doc.removeEventListener('keydown', unlock, true); };
    };
    bind(); const unsubscribe = host?.surfaces.subscribe(bind);
    return () => { detach(); unsubscribe?.(); };
  }, [audio, host, introDone]);
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(null);
  useEffect(() => account?.session.registerStop(() => settings.idle()), [account?.session, settings]);
  useEffect(() => { void settings.start(); return () => settings.stop(); }, [settings]);
  useEffect(() => { onboarding.setPipAvailable(host?.pip.available ?? false); }, [host, onboarding]);
  useEffect(() => host?.pip.subscribe(() => { if (host.pip.status === 'pip') onboarding.acknowledgePip(); }), [host, onboarding]);
  if (!localTest && !s.state) return <div role="status" className="settings-retry-note">
    {s.phase === 'error' ? <button onClick={() => { void settings.retry(); }}>게임 기록을 불러오지 못했어요 · 다시 시도</button> : '게임 기록을 불러오는 중…'}
  </div>;
  if (!introDone) return <FirstVisitIntro key={introAccount} onStart={() => {
    settings.markCutsceneViewed(introCutsceneId);
    setSeenAccounts(previous => new Set([...previous, introAccount]));
  }}/>;
  return <AudioContext.Provider value={audio}>
    <RuntimeStage scale={scale} preferences={settings} onboarding={localTest?undefined:onboarding} onEnvironment={setEnvironment} onSceneSeason={onSceneSeason}/>
    <PipControls/>
    <SeasonControl controller={settings}/>
    <Collections settings={settings} environment={environment} display={collectionDisplay}/>
    {!localTest && <OnboardingNotice controller={onboarding}/>}
    {s.phase === 'error' && <button className="settings-retry-note" data-capture-blocker onClick={e => { e.stopPropagation(); void settings.retry(); }}>설정·안내 저장 확인 필요 · 다시 시도</button>}
  </AudioContext.Provider>;
}
