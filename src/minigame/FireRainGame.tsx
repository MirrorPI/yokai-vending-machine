import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { advanceRain, arena, createRoundWind, drawFlame, drawRain, makeDrop, rainImpact, rainMotion } from './fire-animation.ts';
import type { Point } from './fire-animation.ts';
import rainSound from './forest-rain.wav';
import startImage from './before-the-rain.png';
import storyImage from './under-the-umbrella.png';

const directions: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 }, a: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 }, d: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 }, w: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 }, s: { x: 0, y: 1 },
};
const startPoint = (): Point => ({ x: arena.width / 2, y: arena.height * .66 });
const recordKey = 'yokai:minigame:fire-preview-best';

function loadBest() {
  try {
    const value = Number(window.localStorage.getItem(recordKey));
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function formatTime(centiseconds: number) {
  const minutes = Math.floor(centiseconds / 6000);
  const seconds = Math.floor(centiseconds / 100) % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`;
}

type Round = 'ready' | 'playing' | 'extinguishing' | 'result';

function movement(keys: Set<string>, target: Point | null, position: Point): Point {
  const vector = { x: 0, y: 0 };
  for (const key of keys) {
    vector.x += directions[key].x;
    vector.y += directions[key].y;
  }
  if (target && !vector.x && !vector.y) {
    vector.x = (target.x - position.x) / 16;
    vector.y = (target.y - position.y) / 16;
  }
  const magnitude = Math.max(1, Math.hypot(vector.x, vector.y));
  return { x: vector.x / magnitude, y: vector.y / magnitude };
}

export function FireRainGame({ preview = false, demo = false }: { preview?: boolean; demo?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const rainContext = useRef<AudioContext | null>(null);
  const rainReady = useRef<Promise<void> | null>(null);
  const [rainEnabled, setRainEnabled] = useState(false);
  const wantsRain = useRef(false);

  async function playRain() {
    let context: AudioContext | null = null;
    try {
      context = rainContext.current ??= new AudioContext();
      const resumed = context.resume();
      if (!rainReady.current) {
        const ctx = context;
        rainReady.current = (async () => {
          const response = await fetch(rainSound);
          if (!response.ok) throw new Error('Rain audio unavailable');
          const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
          if (rainContext.current !== ctx) return;
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.loop = true;
          const volume = ctx.createGain();
          volume.gain.value = .48;
          source.connect(volume).connect(ctx.destination);
          source.start();
        })();
      }
      await Promise.all([resumed, rainReady.current]);
    } catch {
      if (rainContext.current !== context) return;
      void context?.close().catch(() => {});
      rainContext.current = null;
      rainReady.current = null;
      wantsRain.current = false;
      setRainEnabled(false);
    }
  }

  useEffect(() => {
    const doc = canvas.current!.ownerDocument;
    const sync = () => {
      if (doc.hidden) void rainContext.current?.suspend().catch(() => {});
      else if (wantsRain.current) void playRain();
    };
    doc.addEventListener('visibilitychange', sync);
    return () => {
      doc.removeEventListener('visibilitychange', sync);
      void rainContext.current?.close().catch(() => {});
      rainContext.current = null;
      rainReady.current = null;
    };
  }, []);

  const keys = useRef(new Set<string>());
  const pointer = useRef<{ id: number; target: Point } | null>(null);
  const action = useRef<'story' | 'start' | null>(null);
  const [round, setRound] = useState<Round>('ready');
  const [time, setTime] = useState(0);
  const [best, setBest] = useState(() => demo ? 0 : loadBest());
  const [storyPreview, setStoryPreview] = useState(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (round === 'result') resultHeading.current?.focus({ preventScroll: true });
  }, [round]);

  useEffect(() => {
    const element = canvas.current!;
    const ctx = element.getContext('2d');
    const doc = element.ownerDocument;
    const win = doc.defaultView;
    if (!ctx || !win) return;
    const reducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)');
    let position = startPoint();
    let velocity = { x: 0, y: 0 };
    let drops: ReturnType<typeof makeDrop>[] = [];
    let wind = createRoundWind();
    let elapsed = 0;
    let last = 0;
    let frame = 0;
    let pendingRain = 0;
    let extinguished: number | null = null;
    let phaseState: Round = 'ready';
    let elapsedRound = 0;
    let displayedTime = 0;
    let bestTime = demo ? 0 : loadBest();
    const clearInput = () => { keys.current.clear(); pointer.current = null; };

    const render = (now: number) => {
      const dt = last === 0 ? 0 : Math.min(.05, (now - last) / 1000);
      last = now;
      if (action.current === 'start') {
        wind = createRoundWind();
        elapsed = 0;
        elapsedRound = 0;
        displayedTime = 0;
        setTime(0);
        position = startPoint();
        velocity = { x: 0, y: 0 };
        drops = [];
        pendingRain = 0;
        extinguished = null;
        phaseState = 'playing';
        setRound(phaseState);
        clearInput();
      } else if (action.current === 'story') {
        extinguished = elapsed;
        velocity = { x: 0, y: 0 };
        phaseState = 'extinguishing';
        setRound(phaseState);
        clearInput();
      }
      action.current = null;
      if (phaseState === 'result') {
        if (!doc.hidden) frame = win.requestAnimationFrame(render);
        return;
      }
      elapsed += dt;
      if (extinguished !== null && elapsed - extinguished >= 1.15) {
        phaseState = 'result';
        setRound(phaseState);
      }

      const intent = extinguished === null ? movement(keys.current, pointer.current?.target ?? null, position) : { x: 0, y: 0 };
      const nx = Math.min(arena.width - 16, Math.max(16, position.x + intent.x * 76 * dt));
      const ny = Math.min(arena.height - 12, Math.max(26, position.y + intent.y * 76 * dt));
      if (dt > 0) {
        const ease = 1 - Math.exp(-dt * 17);
        velocity = {
          x: velocity.x + ((nx - position.x) / (76 * dt) - velocity.x) * ease,
          y: velocity.y + ((ny - position.y) / (76 * dt) - velocity.y) * ease,
        };
      }
      const rain = rainMotion(elapsed, wind(elapsed));
      for (const drop of drops) {
        drop.dx = rain.x * drop.speedScale;
        drop.dy = rain.y * drop.speedScale;
      }
      pendingRain += dt * rain.rate;
      while (pendingRain >= 1) { drops.push(makeDrop(rain)); pendingRain--; }
      const nextPosition = { x: nx, y: ny };
      if (phaseState === 'playing') {
        const impact = rainImpact(drops, position, nextPosition, dt);
        elapsedRound += dt * (impact ?? 1);
        const clock = Math.floor(elapsedRound * 100);
        if (impact !== null) {
          position = { x: position.x + (nx - position.x) * impact, y: position.y + (ny - position.y) * impact };
          extinguished = elapsed;
          clearInput();
          phaseState = 'extinguishing';
          setRound(phaseState);
          if (!demo && clock > bestTime) {
            bestTime = clock;
            setBest(clock);
            try { win.localStorage.setItem(recordKey, String(clock)); } catch { /* Keep the current session record. */ }
          }
        } else {
          position = nextPosition;
        }
        if (impact !== null || clock - displayedTime >= 10) {
          displayedTime = clock;
          setTime(clock);
        }
      } else {
        position = nextPosition;
      }
      drops = advanceRain(drops, dt);
      ctx.clearRect(0, 0, arena.width, arena.height);
      drawRain(ctx, drops);
      drawFlame(ctx, position, velocity, reducedMotion.matches ? 0 : elapsed, extinguished === null ? null : elapsed - extinguished);
      if (!doc.hidden) frame = win.requestAnimationFrame(render);
    };
    const visibility = () => {
      win.cancelAnimationFrame(frame);
      last = 0;
      clearInput();
      if (!doc.hidden) frame = win.requestAnimationFrame(render);
    };
    visibility();
    doc.addEventListener('visibilitychange', visibility);
    win.addEventListener('blur', clearInput);
    return () => {
      win.cancelAnimationFrame(frame);
      doc.removeEventListener('visibilitychange', visibility);
      win.removeEventListener('blur', clearInput);
      clearInput();
    };
  }, [demo]);

  function movePointer(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    pointer.current = { id: event.pointerId, target: {
      x: (event.clientX - rect.left) * arena.width / rect.width,
      y: (event.clientY - rect.top) * arena.height / rect.height,
    } };
  }

  function startRound() {
    action.current = 'start';
    setStoryPreview(false);
    setRound('playing');
    canvas.current?.ownerDocument.defaultView?.requestAnimationFrame(() => canvas.current?.focus({ preventScroll: true }));
  }

  return <main className="fire-preview">
    <link rel="preload" as="image" href={storyImage}/>
    <header><h1>도깨비불아, 비를 피해!</h1><p id="fire-controls">방향키·WASD로 움직이거나, 화면을 드래그해서 빗방울을 피하세요.</p></header>
    <div className={(round === 'ready' || round === 'result') ? 'fire-arena fire-arena-result' : 'fire-arena'}>
      <img className="fire-arena-bg" src={`${import.meta.env.BASE_URL}game-assets/배경/forest/summer/scene.png`} alt="" draggable={false}/>
      <canvas ref={canvas} width={arena.width} height={arena.height} tabIndex={round === 'playing' ? 0 : -1} aria-hidden={round !== 'playing'} aria-label="도깨비불 게임 화면" aria-describedby="fire-controls"
        onKeyDown={event => {
          const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
          if (!Object.hasOwn(directions, key) || event.altKey || event.ctrlKey || event.metaKey) return;
          event.preventDefault(); keys.current.add(key);
        }}
        onKeyUp={event => keys.current.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key)}
        onBlur={() => keys.current.clear()}
        onPointerDown={event => {
          if (pointer.current || event.button !== 0) return;
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId); movePointer(event);
        }}
        onPointerMove={event => { if (pointer.current?.id === event.pointerId) movePointer(event); }}
        onLostPointerCapture={event => { if (pointer.current?.id === event.pointerId) pointer.current = null; }}/>
      {round === 'ready' && <div className="fire-title-card">
        <img src={startImage} alt="숲속 자판기 앞에서 첫 빗방울을 올려다보는 도깨비불"/>
        <button data-stone="primary" type="button" onClick={startRound}>게임 시작</button>
      </div>}
      {round === 'playing' || (round === 'extinguishing' && !storyPreview) ? <span className="fire-clock" aria-label="생존 시간">{formatTime(time)}</span> : null}
      {round === 'result' && <div className="fire-title-card"><img className="fire-story-art" src={storyImage} alt="빗속에서 불꽃이 꺼져 울상이 된 작은 도깨비불 위로 카라카사오바케가 몸을 기울여 비를 막아준다."/>
        {!storyPreview && <div className="fire-round-score"><span>이번 기록</span><strong>{formatTime(time)}</strong></div>}
        <button data-stone="primary" type="button" onClick={startRound}>{storyPreview ? '게임 시작' : '다시 하기'}</button>
      </div>}
    </div>
    <div className="fire-preview-controls">
      <button data-stone="secondary" type="button" aria-label="빗소리" aria-pressed={rainEnabled}
        onClick={() => {
          wantsRain.current = !rainEnabled;
          setRainEnabled(!rainEnabled);
          if (rainEnabled) void rainContext.current?.suspend().catch(() => {});
          else void playRain();
          if (round === 'playing') canvas.current?.focus({ preventScroll: true });
        }}>빗소리 {rainEnabled ? '켜짐' : '꺼짐'}</button>
      {round === 'playing' && <button className="fire-start" type="button" onClick={startRound}>처음부터</button>}
      {preview && round === 'ready' && <button type="button" onClick={() => { setStoryPreview(true); action.current = 'story'; }}>스토리 컷 미리보기</button>}
    </div>
    {round === 'result' && <section className="fire-result" aria-labelledby="fire-result-title">
      <h2 id="fire-result-title" ref={resultHeading} tabIndex={-1}>우산 아래</h2>
      <p>도깨비불이 울먹이자 카라카사오바케가 살며시 비를 가려 주었어요. “잠깐 쉬어도 돼.”</p>
      {!storyPreview && !demo && <dl><div><dt>이 브라우저 최고 기록</dt><dd>{formatTime(best)}</dd></div></dl>}
    </section>}
  </main>;
}
