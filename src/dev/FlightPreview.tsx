import { useEffect, useMemo, useRef, useState } from 'react';
import { assetCatalog, assetUrl } from '../data/catalog.ts';
import { compileScene, withFlightDirection } from '../scene/composition.ts';
import { createBrowserImageLoader, SceneBundleController } from '../scene/bundle.ts';
import type { PreparedScene } from '../scene/bundle.ts';
import type { Family, FlightDirection, Season } from '../scene/types.ts';
import { SceneView } from '../scene/SceneView.tsx';
import './flight-preview.css';
const guests = assetCatalog.yokai.filter(y => y.art?.animation.metadata.flight);
const seasons: Record<Season,string> = {spring:'봄',summer:'여름',autumn:'가을',winter:'겨울'};
type DirectionMode = FlightDirection | 'random';
const pick = (mode: DirectionMode): FlightDirection[] => guests.map(() => mode === 'random' ? Math.random()<.5 ? 'left-to-right' : 'right-to-left' : mode);
/** Development-only viewer. No account, repository, observation or reward ports. */
export function FlightPreview() {
  const [family,setFamily]=useState<Family>('forest'), [mode,setMode]=useState<DirectionMode>('random');
  const [directions,setDirections]=useState(()=>pick('random'));
  const [bundles,setBundles]=useState<PreparedScene[]>([]),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const [time,setTime]=useState(0),[running,setRunning]=useState(true),[loop,setLoop]=useState(true);
  const clock=useRef(0);
  const duration=Math.max(...guests.map(y=>y.art!.animation.metadata.flight!.durationMs));
  useEffect(()=>{
    let cancelled=false;
    const loaders=guests.map(()=>new SceneBundleController(createBrowserImageLoader(assetUrl)));
    setBundles([]);setError('');clock.current=0;setTime(0);
    void Promise.all(guests.map((y,i)=>loaders[i].request(compileScene(assetCatalog,{family,season:y.seasons[0] as Season,yokaiId:y.id,playback:{originMs:0}}))))
      .then(results=>{if(cancelled)return;if(results.some(r=>r.status!=='committed'))setError('장면을 불러오지 못했어요. 다시 시도해 주세요.');else setBundles(results.flatMap(r=>r.status==='committed'?[r.bundle]:[]));});
    return ()=>{cancelled=true;loaders.forEach(l=>l.cancel());};
  },[family,attempt]);
  useEffect(()=>{
    if(!running||bundles.length!==guests.length)return;
    let frame=0,previous=performance.now();
    const tick=(now:number)=>{
      clock.current+=Math.max(0,Math.min(100,now-previous));previous=now;
      if(clock.current>=duration+(loop?800:0)){
        if(loop){clock.current=0;setDirections(pick(mode));}
        else{clock.current=duration;setTime(duration);setRunning(false);return;}
      }
      setTime(Math.min(clock.current,duration));frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
  },[running,loop,mode,bundles,duration]);
  const oriented=useMemo(()=>bundles.map((b,i)=>({...b,plan:withFlightDirection(b.plan,directions[i])})),[bundles,directions]);
  const restart=(nextMode=mode)=>{clock.current=0;setTime(0);setDirections(pick(nextMode));setRunning(true);};
  return <main className="flight-preview">
    <header><div><span className="flight-eyebrow">요괴 자판기 · 움직임 미리보기</span><h1>하늘을 스치는 네 손님</h1><p>각 요괴의 비행 경로는 <strong>4초</strong>예요. 방향을 바꾸거나 시간을 멈춰 날갯짓을 살펴보세요.</p></div><a href="/local-login">게임으로 돌아가기 ↗</a></header>
    <section className="flight-toolbar" aria-label="비행 재생 설정">
      <label>비행 방향<select value={mode} onChange={e=>{const m=e.target.value as DirectionMode;setMode(m);restart(m);}}><option value="random">등장마다 무작위 · 좌우 반반</option><option value="left-to-right">왼쪽 → 오른쪽</option><option value="right-to-left">오른쪽 → 왼쪽</option></select></label>
      <label>장소<select value={family} onChange={e=>setFamily(e.target.value as Family)}><option value="forest">숲</option><option value="hill">밤하늘</option></select></label>
      <button disabled={!bundles.length} onClick={()=>{if(time>=duration&&!running)restart();else setRunning(!running);}}>{running?'일시정지':'재생'}</button>
      <button disabled={!bundles.length} onClick={()=>restart()}>처음부터 보기</button>
      <label className="flight-loop"><input type="checkbox" checked={loop} onChange={e=>setLoop(e.target.checked)}/>반복 재생</label>
    </section>
    <div className="flight-timeline"><output aria-live="off">{(time/1000).toFixed(2)} / {(duration/1000).toFixed(2)}초</output><input aria-label="비행 시간" type="range" min="0" max={duration} step="10" value={time} onChange={e=>{setRunning(false);clock.current=Number(e.target.value);setTime(clock.current);}}/><span>{time>=duration?'통과 완료':running?'날아가는 중':'멈춘 장면'}</span></div>
    {error?<p role="alert">{error} <button onClick={()=>setAttempt(attempt+1)}>다시 불러오기</button></p>:!bundles.length?<p role="status">네 계절의 하늘을 준비하고 있어요…</p>:null}
    <div className="flight-grid">{guests.map((y,i)=><article className="flight-card" key={y.id}>
      <div className="flight-card-heading"><span>{seasons[y.seasons[0] as Season]} · 특수</span><h2>{y.name}</h2><p>{directions[i]==='left-to-right'?'왼쪽 → 오른쪽':'오른쪽 → 왼쪽'} <span>· {y.art!.animation.metadata.flight!.durationMs/1000}초</span></p></div>
      <div className="flight-stage">{oriented[i]&&<SceneView bundle={oriented[i]} nowMs={time} scale={1.25}/>}</div>
      <p className="flight-card-note">{y.description.split('요.')[0]}요.</p>
    </article>)}</div>
    <p className="flight-footnote">움직임을 확인하는 전용 화면이에요. 촬영 기록이나 물건함은 바뀌지 않아요.</p>
  </main>;
}
