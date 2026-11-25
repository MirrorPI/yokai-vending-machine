// Only installed by local-preview.mjs. Never imported by the app or Lambda bundle.
const origin='http://127.0.0.1:5174';
const config={enabled:true,apiBaseUrl:'http://127.0.0.1:5180',cognitoDomain:origin,clientId:'fixture',userPoolId:'ap-northeast-2_fixture',region:'ap-northeast-2',redirectUri:origin+'/',logoutUri:origin+'/'};
const page=`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>로컬 테스트 로그인 · 요괴 자판기</title>
<style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;color:#e8ede7;background:#15201d}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px}main{width:100%;max-width:440px;padding:32px;border:1px solid #526350;border-radius:20px;background:#202d27;box-shadow:0 24px 70px #0004}.brand{font-size:13px;letter-spacing:.12em;color:#c3d7b1}h1{font-size:27px;line-height:1.4;margin:16px 0}p{line-height:1.7;color:#bec9bf;font-size:14px}.notice{padding:14px;background:#16221c;border-radius:10px}label{display:block;margin-top:24px;margin-bottom:9px;font-size:14px}select,button{width:100%;min-height:48px;border-radius:9px;font:inherit}select{background:#15201d;color:#ecf1e9;border:1px solid #687965;padding:10px}button{margin:16px 0;background:#d2e6b7;color:#1e2b20;border:0;font-weight:700;cursor:pointer}button:hover{background:#e4f2d1}a{color:#cbdcc0;text-underline-offset:4px}.guest{display:block;text-align:center;font-size:14px;margin-top:6px}small{display:block;color:#a5b5a7;line-height:1.7;margin-top:24px}select:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid #f5db95;outline-offset:3px}
</style></head><body><main>
<div class="brand">요괴 자판기 · LOCAL</div><h1>로컬 테스트 로그인</h1>
<p>계정을 골라 게임을 시작하세요.<br>같은 계정으로 다시 들어오면 기록이 이어져요.</p>
<p class="notice">이 Mac에서만 사용하는 개발용 로그인입니다. 실제 이메일·비밀번호 입력이나 AWS 회원가입은 하지 않아요.</p>
<form action="/" method="get"><label for="account">테스트 계정</label><select id="account" name="accountTestSubject"><option value="fixture-manual">테스트 계정 A · 기존 테스트 기록</option><option value="fixture-second">테스트 계정 B · 별도 기록</option></select><button type="submit">로그인</button></form>
<a class="guest" href="/">게스트로 둘러보기</a>
<small>기록과 사진은 이 Mac에 저장됩니다. 계정 A와 B의 기록은 분리돼요. 실제 AWS 인증·이메일 확인 과정은 이 화면에 포함되지 않습니다.</small>
</main></body></html>`;

export function localAccountResponse({url,host,method}) {
  const pathname=new URL(url,'http://localhost').pathname;
  if(!['/account-config.json','/local-login','/oauth2/authorize'].includes(pathname))return null;
  if(host!=='127.0.0.1:5174')return {status:403,type:'text/plain',body:'Loopback host required'};
  if(method!=='GET'&&method!=='HEAD')return {status:405,type:'text/plain',body:'Read only'};
  return {status:200,type:pathname==='/account-config.json'?'application/json':'text/html; charset=utf-8',body:pathname==='/account-config.json'?JSON.stringify(config):page};
}
