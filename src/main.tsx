import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './app/styles.css';
import './minigame/fire-rain.css';
import './app/stone.css';
import './encyclopedia/field-guide.css';
import './inventory/inventory.css';

const { hostname, pathname, search } = window.location;
const query = new URLSearchParams(search);
const publicHost = hostname === 'yokaivendingmachine.com' || hostname === 'www.yokaivendingmachine.com';
const maintenance = hostname === 'd3qbqa2c67mwd1.cloudfront.net'
  || (import.meta.env.DEV && query.has('legacy-notice'));
const guestOnly = publicHost || (import.meta.env.DEV && query.has('public-play'));
const showSiteGuide = !maintenance && !query.has('play')
  && (publicHost || (import.meta.env.DEV && query.has('site-guide')));

if (!showSiteGuide) {
  const siteGuide = document.getElementById('site-guide');
  if (siteGuide) siteGuide.hidden = true;
  const root = createRoot(document.getElementById('root')!);

  if (maintenance) {
    const notice = <div className="maintenance-card">
      <h1>요괴 자판기 데모</h1>
      <p>여기서는 플레이 기록이 저장되지 않아요. 미니게임을 가볍게 체험하며 조금만 기다려 주세요.</p>
      <a className="demo-link" href="https://www.yokaivendingmachine.com/">정식 사이트로 이동</a>
    </div>;
    if (pathname === '/demo') {
      void import('./minigame/FireRainGame.tsx').then(({ FireRainGame }) => root.render(<>{notice}<FireRainGame demo/></>));
    } else {
      root.render(<main className="maintenance-screen"><section>{notice}<a className="demo-link" href="/demo?legacy-notice">미니게임 체험하기</a></section></main>);
    }
  } else if (import.meta.env.DEV && pathname === '/flight-preview') {
    void import('./dev/FlightPreview.tsx').then(({ FlightPreview }) => root.render(<StrictMode><FlightPreview /></StrictMode>));
  } else if (import.meta.env.DEV && pathname === '/minigame-preview') {
    void import('./minigame/FireRainGame.tsx').then(({ FireRainGame }) => root.render(<StrictMode><FireRainGame preview /></StrictMode>));
  } else {
    void import('./app/App.tsx').then(({ App }) => root.render(<StrictMode><App guestOnly={guestOnly} /></StrictMode>));
  }
}
