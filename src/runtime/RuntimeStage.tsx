import { useAccount } from '../account/context.tsx';
import { OnboardingExecutionBridge } from '../onboarding/execution.ts';
import type { SettingsController } from '../settings/controller.ts';
import type { OnboardingController } from '../onboarding/controller.ts';
import type { EnvironmentStatus } from '../settings/SettingsPanel.tsx';
import { useEffect, useRef, useState } from 'react';
import { assetCatalog, assetUrl } from '../data/catalog.ts';
import { SceneBundleController } from '../scene/bundle.ts';
import { createBrowserCaptureImageLoader } from '../capture/browser.ts';
import { RuntimeController } from './controller.ts';
import { RuntimeView } from './RuntimeView.tsx';
import { browserOffset } from './rules.ts';
import { seededRandom } from './preview.ts';
import type { RuntimePreview } from './preview.ts';
import { createOrdinaryCapture } from '../app/capture.ts';
import { ObservationCoordinator } from '../observation/coordinator.ts';
import { liveTransfer, verifiedTransferScene } from '../observation/transfer.ts';
import { ObservationSession } from '../observation/session.ts';
import { retryObservation } from '../observation/retry.ts';
import { observationNotice } from '../observation/notice.ts';
import { BrowserPresentationHost } from '../observation/browser.ts';
import { useSurface } from '../observation/context.tsx';
import { createBrowserRepository } from '../storage/browser.ts';
import { useGameAudio } from '../audio/context.tsx';
import type { Season } from '../domain/state.ts';
import type { PresentationTicket } from './execution.ts';
import { isLocalCollectionTest } from './local-collection-test.ts';
import { LocalVisitTools } from './LocalVisitTools.tsx';

/** Actual document host. Preview keeps its explicit, nonpersistent assertions. */
export function RuntimeStage({ scale, verification = null, preferences, onboarding, onEnvironment, onSceneSeason }: {
  scale: number; verification?: RuntimePreview | null; preferences?: SettingsController;
  onboarding?: OnboardingController; onEnvironment?(status: EnvironmentStatus): void; onSceneSeason?(season: Season): void;
}) {
  const audio = useGameAudio();
  const audioRef = useRef(audio); audioRef.current = audio;
  const { host: surfaceHost, generation } = useSurface();
  const account = useAccount(), storage = account?.ports;
  const localTest = import.meta.env.DEV && isLocalCollectionTest({development:true,hostname:location.hostname,search:location.search,apiBaseUrl:account?.session.config.apiBaseUrl,accountKey:storage?.accountKey});
  const element = useRef<HTMLDivElement>(null);
  const browser = useRef<BrowserPresentationHost | null>(null);
  const presentation = useRef<PresentationTicket | null>(null);
  const coordinatorRef = useRef<ObservationCoordinator | null>(null);
  const sessionRef = useRef<ObservationSession | null>(null);
  const [authorityNotice, setAuthorityNotice] = useState('관찰권을 확인하고 있어요.');
  const active = useRef<RuntimeController | null>(null);
  const captureHost = useRef<ReturnType<typeof createOrdinaryCapture> | null>(null);
  const advance = useRef(0);
  const authorized = useRef(false);
  const [snapshot, setSnapshot] = useState<ReturnType<RuntimeController['snapshot']> | null>(null);
  const [now, setNow] = useState(0);
  const firstDisplay = useRef<number | null>(null);
  const [captureNotice, setCaptureNotice] = useState<{text:string;temporary:boolean}|null>(null);
  const [shutter, setShutter] = useState(0);
  const retrying=useRef(false);
  useEffect(()=>{
    if(!captureNotice?.temporary)return;
    const timer=window.setTimeout(()=>setCaptureNotice(null),2000);
    return ()=>window.clearTimeout(timer);
  },[captureNotice]);
  useEffect(() => {
    let alive = true;
    let cleanup = () => {};
    const boot = async () => {
      const read = preferences ? await preferences.refresh() : null;
      if (!alive) return;
      const firstArrival = read && onboarding?.initialize(read);
      authorized.current = false;
      advance.current = 0;
      const clock = { wall: () => (storage?.serverNow?.() ?? Date.now()) + advance.current, monotonic: () => performance.timeOrigin + performance.now() + advance.current };
      const loadImage = createBrowserCaptureImageLoader(file => new URL(assetUrl(file), document.baseURI).href);
      const surfaces = surfaceHost?.surfaces;
      const session = !verification && surfaces ? new ObservationSession({ repository: storage?.repository ?? createBrowserRepository(),
        lockName: storage?.accountKey ? `yokai-vending:observation:account:${storage.accountKey}` : undefined,
        locks: navigator.locks, sessionId: crypto.randomUUID(), observable: surfaces.observable }) : null;
      sessionRef.current = session;
      const displayHost = surfaces && element.current ? new BrowserPresentationHost(surfaces, element.current, clock.monotonic) : null;
      browser.current = displayHost;
      const prepare = async (plan: Parameters<RuntimeController['transition']['request']>[0]) => {
        const loader = new SceneBundleController(loadImage);
        const result = await loader.request(plan);
        if (result.status !== 'committed') throw new Error(loader.state.error ?? 'Bundle preparation interrupted');
        return result.bundle;
      };
      const controller = new RuntimeController({ catalog: assetCatalog, clock, offset: browserOffset,
        random: verification ? seededRandom(verification.seed) : Math.random, createVisitId: () => crypto.randomUUID(),
        prepare }, verification ? { family: verification.family, verificationSeason: verification.season } : { fixedSeason: chosenSeason(read?.status === 'ok' ? read.state : null), family: read?.status === 'ok' ? read.state.settings.backgroundFamily : 'forest', ...(localTest ? {manualSelection:true} : firstArrival ? { firstArrival: { maxDelayMs: 0 } } : {}) });
      active.current = controller;
      let requestedFamily = read?.status === 'ok' ? read.state.settings.backgroundFamily : 'forest';
      const unsubscribe = preferences?.subscribe(() => {
        // Apply a family only after persistence; failed selections remain visible in settings.
        if (!verification) controller.requestSeasonMode(chosenSeason(preferences.snapshot.state));
        const family = preferences.snapshot.state?.settings.backgroundFamily;
        if (family && family !== requestedFamily) { requestedFamily = family; controller.requestFamily(family); }
      });
      let guideVisit: string | null = null, receiptId: string | null = null, environmentKey = '';
      let displayedSeason: Season | null = null;
      const guideBridge = onboarding && preferences ? new OnboardingExecutionBridge(onboarding, preferences) : null;
      const retryEnvironment = () => controller.transition.retry();
      const afterSync = () => {
        if (!alive || !capture) return;
        const visit = controller.scheduler.state.visit;
        if (visit && controller.scheduler.state.startStatus === 'approved' && guideVisit !== visit.visitId) {
          guideVisit = visit.visitId;
          audioRef.current?.arrival(visit.visitId);
        }
        if (!visit) guideVisit = null;
        const receipt = capture.execution.receipt;
        if (receipt && receiptId !== receipt.visitId) {
          receiptId = receipt.visitId;
        }
        void guideBridge?.synchronize(visit, controller.scheduler.state.startStatus === 'approved', receipt);
      };
      const capture = verification ? null : createOrdinaryCapture({ scheduler: controller.scheduler, clock,
        surfaceStable: () => !surfaces?.moving, waitForSurface: () => surfaces?.waitForMove() ?? Promise.resolve(),
        authority: () => session?.authority() ?? { owner: null, authorized: false, observable: false },
        confirmDisplay: (ticket, evidence) => displayHost?.confirmDisplay(ticket, evidence) ?? false,
        confirmInput: (context, sample, input) => displayHost?.confirmInput(context, sample, input) ?? false,
        photoSeasons: id => assetCatalog.yokai.find(y => y.id === id)?.seasons ?? [],
        definition: id => {
          const yokai = assetCatalog.yokai.find(y => y.id === id);
          if (!yokai?.art) throw new Error('Missing original capture definition');
          return { giant: yokai.giant ?? null, metadata: yokai.art.animation.metadata };
        } }, storage ?? undefined);
      captureHost.current = capture;
      let coordinator: ObservationCoordinator | null = null;
      let syncing: Promise<void> | null = null;
      const sync = (force = false) => {
        if (surfaces?.moving || (coordinator?.busy && !force)) return Promise.resolve();
        if (!syncing && capture) syncing = capture.synchronize().then(afterSync).finally(() => { syncing = null; });
        return syncing ?? Promise.resolve();
      };
      coordinator = session ? new ObservationCoordinator(session, typeof BroadcastChannel === 'function' ? new BroadcastChannel(storage?.accountKey ? `yokai-vending:observation:account:${storage.accountKey}` : 'yokai-vending:observation') : null, {
        offer: async () => {
          await capture?.execution.quiesce(); await capture?.jobs.drain();
          const s = controller.scheduler.state;
          if (!s.visit && capture?.execution.status.state === 'ready') return 'idle';
          return liveTransfer(s);
        },
        retire: () => { capture?.capture.retireTransfer(); capture?.execution.retireTransfer(); presentation.current = null; },
        accept: async transfer => {
          if (!alive || !capture) return;
          capture.capture.retireTransfer(); capture.execution.retireTransfer();
          if (transfer) {
            try {
              const r = transfer.visit;
              const { plan, candidate } = verifiedTransferScene(assetCatalog, transfer);
              const bundle = await prepare(plan);
              if (alive && await capture.execution.adoptTransfer({ ...transfer, candidate }, bundle)) {
                // The sender already observed this arrival/settlement. Moving a
                // live visit never replays arrival/shutter signals in a peer.
                guideVisit = r.visitId; receiptId = transfer.settlementSource ? r.visitId : null;
              }
            }
            catch { /* A05 recovers only the actual persisted visit. */ }
          }
          await sync(true);
        },
      }) : null;
      coordinatorRef.current = coordinator;
      const observation = () => {
        if (!alive || surfaces?.moving) return;
        if (capture && session && surfaces) {
          if (!surfaces.observable()) {
            // Synchronous ingress latches a real interruption, even if it becomes
            // visible again while storage is pending. A DOM move publishes once.
            void capture.interrupt().then(afterSync).then(async () => {
              if (!surfaces.observable()) await session.release();
            });
          } else void coordinator?.request().then(() => sync());
          void sync();
        } else controller.scheduler.setObservation({ observable: document.visibilityState === 'visible', authorized: authorized.current });
      };
      const freeze = () => { if (capture) void capture.interrupt().then(afterSync); else controller.scheduler.suspend(); };
      const removeSession = session?.subscribe(() => { if (alive) { setAuthorityNotice(session.status); if (!coordinator?.busy) void sync(); } });
      const removeSurface = surfaces?.subscribe(() => { lastHostTime = null; observation(); scheduleFrame(); });
      let frame = 0;
      let frameWindow: Window = surfaces?.window ?? window;
      let lastHostTime: number | null = null;
      const tick = (hostTime: number) => {
        if (!alive) return;
        // Conservative freeze detection. No historical wait intervals are replayed.
        if (lastHostTime !== null && hostTime - lastHostTime > 5000) freeze();
        lastHostTime = hostTime;
        if (coordinator?.busy || surfaces?.moving) { scheduleFrame(); return; }
        controller.pulse();
        if (capture) {
          void sync();
          const state = controller.scheduler.state;
          if (state.phase === 'awaiting-display') presentation.current = capture.execution.beginPresentation(state.display!.token);
          if (state.phase === 'no-candidates') setAuthorityNotice('현재 계절에 검증된 일반 손님을 준비할 수 없어요. 제작 자료를 기다리고 있어요.');
        }
        const environment = { requested: controller.transition.state.requested?.family ?? null,
          displayed: controller.transition.sample().current?.plan.input.family ?? null, status: controller.transition.state.status };
        const key = JSON.stringify(environment);
        if (key !== environmentKey) { environmentKey = key; onEnvironment?.({ ...environment, retry: retryEnvironment }); }
        setNow(clock.monotonic());
        const next = controller.snapshot();
        if (next.displayedSeason && next.displayedSeason !== displayedSeason) {
          displayedSeason = next.displayedSeason;
          onSceneSeason?.(displayedSeason);
        }
        setSnapshot(next);
        scheduleFrame();
      };
      function scheduleFrame() { frameWindow.cancelAnimationFrame(frame); frameWindow = surfaces?.window ?? window; if (!frameWindow.closed) frame = frameWindow.requestAnimationFrame(tick); }
      const focus = () => { if (surfaces?.observable()) void coordinator?.request(); };
      let focusedWindow = surfaces?.window;
      focusedWindow?.addEventListener('focus', focus);
      const focusDoc = surfaces?.subscribe(() => {
        focusedWindow?.removeEventListener('focus', focus); focusedWindow = surfaces.window;
        focusedWindow?.addEventListener('focus', focus);
      });
      const poll = window.setInterval(() => { if (alive) void coordinator?.pulse(); }, storage ? 30000 : 1000);
      if (session) void session.start().then(observation);
      else observation();
      scheduleFrame();
      const unregisterStop = account?.session.registerStop(async () => {
        // Freeze synchronous ingress before draining already accepted work.
        alive = false; frameWindow.cancelAnimationFrame(frame);
        coordinator?.dispose();
        await capture?.interrupt(); await capture?.execution.quiesce(); await capture?.jobs.drain();
        // Interrupt can leave a settled visit waiting for animation. Finish only
        // its already persisted settlement, never manufacture a reward.
        const repository = storage?.repository ?? createBrowserRepository();
        const read = await repository.read(), owner = session?.authority().owner;
        if (read.status === 'ok' && read.state.activeVisit?.itemGranted && owner) {
          await repository.commit({ type: 'finishVisit', owner, visitId: read.state.activeVisit.visitId }, { expectedRevision: read.state.revision });
        }
        await session?.stop(); capture?.capture.dispose();
      });
      cleanup = () => {
        unregisterStop?.();
        unsubscribe?.();
        guideBridge?.dispose();
        frameWindow.cancelAnimationFrame(frame); removeSession?.(); removeSurface?.();
        coordinator?.dispose(); coordinatorRef.current = null; window.clearInterval(poll); focusDoc?.(); focusedWindow?.removeEventListener('focus', focus);
        void session?.stop(); browser.current = null; presentation.current = null;
        controller.dispose();
        capture?.capture.dispose();
        if (captureHost.current === capture) captureHost.current = null;
        if (active.current === controller) active.current = null;
      };
    };
    void boot();
    return () => { alive = false; cleanup(); };
  }, [verification, preferences, onboarding, onEnvironment, onSceneSeason, surfaceHost, storage, account?.session, localTest]);
  useEffect(() => {
    const ticket = presentation.current, display = browser.current, capture = captureHost.current;
    if (!ticket || !display || !capture || snapshot?.scheduler.phase !== 'presenting') return;
    return display.watch(ticket, evidence => {
      void capture.execution.confirmDisplay(ticket, evidence).then(() => {
        if (captureHost.current === capture && active.current?.scheduler.state.visit && firstDisplay.current === null) firstDisplay.current = performance.now();
      });
    });
  }, [snapshot?.scheduler.phase, snapshot?.scheduler.display?.token, generation]);
  const s = snapshot?.scheduler;
  const preparationFailed = s?.phase === 'preparing' && s.loadStatus === 'failed';
  const executionStatus=captureHost.current?.execution.status;
  const recoveryNotice=observationNotice({phase:sessionRef.current?.phase,status:executionStatus,
    busy:coordinatorRef.current?.busy,preparationFailed});
  return <>
    {localTest && !verification && <LocalVisitTools state={s} request={id=>active.current?.scheduler.requestImmediateVisit(id) ?? false}/>}
    <div ref={element} className="scene-container" data-execution={executionStatus?.state} data-block-reason={executionStatus?.reason ?? undefined} data-observation={sessionRef.current?.phase} data-phase={s?.phase} data-visit-id={s?.visit?.visitId} data-deadline={s?.visit?.deadlineMono} data-origin={s?.visit?.playbackOriginMs} data-now={now} data-owner-epoch={sessionRef.current?.authority().owner?.epoch} data-start={s?.startStatus} data-first-display-delay-ms={firstDisplay.current ?? undefined} style={{ width: 192 * scale, height: 256 * scale }} onClick={event => {
      const host = captureHost.current, scheduler = active.current?.scheduler.state;
      if (!host || verification || coordinatorRef.current?.busy || surfaceHost?.surfaces.moving) return;
      const input = browser.current?.input(event.nativeEvent, scheduler?.visit?.bundle, scheduler?.display?.token);
      if (!input) return;
      void host.capture.click(input).then(result => {
        if (captureHost.current !== host) return;
        if (result.status === 'accepted') {
          setCaptureNotice({text:'찰칵! 촬영 기록과 물건을 보관했어요.',temporary:true});
          setShutter(value => value + 1);
        }
        if (result.status === 'blocked') setCaptureNotice({text:'수집 기록 저장을 확인하지 못했어요.',temporary:false});
      });
    }}>
      {snapshot && <RuntimeView background={snapshot.background} scheduler={snapshot.scheduler} nowMs={now} scale={scale} />}
      <p className="scene-status" role="status" data-capture-blocker>{preparationFailed ? '손님을 불러오지 못했어요. 다시 불러오기를 눌러 주세요.' : active.current?.transition.state.status === 'failed' ? '다음 장면을 불러오지 못했어요. 현재 장면을 유지해요.' :
        snapshot?.background.current ? '' : '장면을 준비하고 있어요.'}</p>
    </div>
    {shutter > 0 && <div key={shutter} className="camera-shutter" aria-hidden="true"
      onAnimationEnd={() => setShutter(0)} />}
    {!verification && (recoveryNotice || authorityNotice !== '이 화면에서 관찰 중이에요.') && <p className="runtime-note" role="status" data-capture-blocker>{recoveryNotice?.message ?? authorityNotice}</p>}
    {!verification && <button className="observation-retry" data-capture-blocker hidden={!recoveryNotice} onClick={e => { e.stopPropagation();
      const session=sessionRef.current,host=captureHost.current;
      if(session&&host&&!retrying.current){retrying.current=true;setCaptureNotice(null);
        void session.ports.repository.read({fresh:true}).then(()=>retryObservation(host,session)).finally(()=>{retrying.current=false;});}
      active.current?.scheduler.retryPreparation();
    }}>{recoveryNotice?.action}</button>}
    {!verification && <p className="capture-note" role="status" data-capture-blocker>{
      captureHost.current?.jobs.status.state === 'failed' ? '사진 저장 안 됨 · 촬영 기록과 물건은 보관했어요.' :
      captureHost.current?.jobs.status.state === 'metadata-pending' ? '사진 완료 기록을 확인하지 못했어요. 재실행 때 파일을 확인해요.' : captureNotice?.text
    }</p>}
    {verification && <div className="runtime-verification" style={{ top: 256 * scale + 64 }}>
      <p>스케줄러 검증 · 표시·승인·정산 결과를 수동 주입합니다. 사용자 기록과 사진은 생성하지 않습니다.</p>
      <p>게임 {snapshot?.gameSeason} / 표시 {snapshot?.displayedSeason} / 요청 {snapshot?.requestedSeason} · {s?.phase}</p>
      <button onClick={() => {
        const c = active.current; if (!c) return;
        authorized.current = true;
        c.scheduler.setObservation({ observable: document.visibilityState === 'visible', authorized: true });
        c.scheduler.confirmRecovery(c.scheduler.state.recoveryToken, true);
      }}>관찰·복귀 확인 주입</button>
      <button onClick={() => { advance.current += 30000; }}>검증 시계 +30초</button>
      <button onClick={() => { advance.current += 1000; }}>검증 시계 +1초</button>
      <button disabled={s?.phase !== 'awaiting-display'} onClick={() => {
        const c = active.current; const display = c?.scheduler.state.display;
        if (display) c!.scheduler.beginPresentation(display.token, { monotonicMs: performance.timeOrigin + performance.now() + advance.current, wallMs: Date.now() + advance.current });
      }}>표시 시작 제안</button>
      <button disabled={s?.phase !== 'presenting'} onClick={() => {
        const c = active.current; const display = c?.scheduler.state.display;
        if (display?.presentation) c!.scheduler.confirmDisplay(display.token, display.presentation);
      }}>표시 확인 주입</button>
      <button disabled={s?.startStatus !== 'pending'} onClick={() => {
        const c = active.current; if (c?.scheduler.state.startRequest) c.scheduler.resolveStart(c.scheduler.state.startRequest.token, 'approved');
      }}>시작 승인 주입</button>
      <button disabled={s?.endStatus !== 'pending'} onClick={() => {
        const c = active.current; if (c?.scheduler.state.endRequest) c.scheduler.resolveEnd(c.scheduler.state.endRequest.token, 'settled');
      }}>정산 결과 주입</button>
      <button disabled={s?.finishStatus !== 'pending'} onClick={() => {
        const c = active.current; if (c?.scheduler.state.finishRequest) c.scheduler.resolveFinish(c.scheduler.state.finishRequest.token, 'complete');
      }}>종료 정리 결과 주입</button>
    </div>}
  </>;
}
import { chosenSeason } from '../domain/season-control.ts';
