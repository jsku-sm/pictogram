'use strict';
const form=document.querySelector('#login-form');
const errorBox=document.querySelector('#login-error');
const statusBox=document.querySelector('#login-status');
const submitButton=document.querySelector('#login-submit');
const passwordInput=document.querySelector('#password');
const params=new URLSearchParams(location.search);
const icon=params.get('icon');
const iconQuery=icon && /^[a-z0-9-]{1,50}$/.test(icon)?`?icon=${encodeURIComponent(icon)}`:'';
const configuration=window.PICTO_CONFIG||{};

function externalTeacherURL(base) {
  try {
    const url=new URL(base);
    if (url.protocol!=='https:' && !(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))) return null;
    return new URL(`/teacher/login${iconQuery}`,url.origin).href;
  } catch { return null; }
}

if (!configuration.serverMode) {
  const target=externalTeacherURL(configuration.teacherBaseUrl);
  if (target) location.replace(target);
  document.querySelector('#login-content').hidden=true;
  document.querySelector('#setup-box').hidden=false;
  document.querySelector('#student-link').href='./index.html';
} else if (params.get('reason')==='expired') {
  statusBox.textContent='로그인 시간이 만료되었습니다. 다시 로그인해 주세요.';
} else if (params.get('reason')==='logout') {
  statusBox.textContent='로그아웃했습니다. 수식 자료를 이 화면에서 지웠습니다.';
}

document.querySelector('#toggle-password').addEventListener('click',event=>{
  const visible=passwordInput.type==='password';
  passwordInput.type=visible?'text':'password';
  event.currentTarget.textContent=visible?'숨기기':'보기';
  event.currentTarget.setAttribute('aria-label',visible?'비밀번호 숨기기':'비밀번호 표시');
  event.currentTarget.setAttribute('aria-pressed',String(visible));
});

form.addEventListener('submit',async event=>{
  event.preventDefault();
  if (!configuration.serverMode) return;
  errorBox.textContent='';
  statusBox.textContent='교사 계정을 확인하고 있습니다…';
  submitButton.disabled=true;
  try {
    const response=await fetch('/api/teacher/login',{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:document.querySelector('#username').value.trim(),password:passwordInput.value}),
    });
    const result=await response.json().catch(()=>({}));
    if (!response.ok) {
      let message=result.error||'로그인에 실패했습니다. 서버 연결을 확인해 주세요.';
      if (response.status===429 && result.retryAfter) message+=` 약 ${Math.ceil(result.retryAfter/60)}분 후 다시 시도하세요.`;
      throw new Error(message);
    }
    form.reset();
    passwordInput.type='password';
    location.replace(`/teacher${iconQuery}`);
  } catch (error) {
    errorBox.textContent=error instanceof TypeError?'서버에 연결할 수 없습니다. 인터넷 연결과 배포 주소를 확인해 주세요.':error.message;
    statusBox.textContent='';
    passwordInput.value='';
    passwordInput.focus();
  } finally {
    submitButton.disabled=false;
  }
});
