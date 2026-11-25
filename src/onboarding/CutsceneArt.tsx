import type { CSSProperties } from 'react';
import { introCuts, type IntroCutId } from './cutscene.ts';

/** Three authored poses per shot, with a continuous camera move over each shot. */
export function CutsceneArt({ cut, ready, onReady, onError }: {
  cut: IntroCutId; ready: boolean; onReady(): void; onError(): void;
}) {
  const row = introCuts.findIndex(c => c.id === cut);
  const source = `${import.meta.env.BASE_URL}cutscenes/forest-intro-faceless-v2.png`;
  return <div className={`cinema-art cinema-art--${cut}`} data-ready={ready} aria-hidden="true">
    <img className="cinema-preload" src={source} alt="" onLoad={onReady} onError={onError}/>
    <div className="cinema-camera">
      <div className="cinema-poses" style={{ '--shot-row': `${row * 25}%`, backgroundImage: `url("${source}")` } as CSSProperties}/>
    </div>
    <div className="cinema-mist"/>
    <div className="cinema-fireflies"><i/><i/><i/><i/><i/></div>
    {cut === 'rustle' && <span className="cinema-rustle">부스럭…</span>}
    <div className="cinema-vignette"/>
  </div>;
}
