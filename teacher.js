'use strict';

const $=selector=>document.querySelector(selector);
const workspace=$('#workspace');
const loading=$('#loading');
const select=$('#icon-select');
const drawing=$('#drawing');
const parts=$('#parts');
const chips=$('#part-select');
const statusBox=$('#copy-status');
let icons=[];
let session=null;
let selectedPart=-1;
let expiryTimer=null;
let loadingData=false;
let leaving=false;
const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('picto-teacher-auth'):null;

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function currentIcon() { return icons.find(icon=>icon.id===select.value); }

function clearPrivateView() {
  clearTimeout(expiryTimer);
  workspace.hidden=true;
  icons=[];
  session=null;
  select.replaceChildren();
  drawing.replaceChildren();
  parts.replaceChildren();
  chips.replaceChildren();
  $('#copy-manual').value='';
  if ($('#copy-dialog').open) $('#copy-dialog').close();
  $('#drawing-title').textContent='';
  $('#drawing-subtitle').textContent='';
  $('#session-user').textContent='';
  $('#session-expiry').textContent='';
  statusBox.textContent='';
}

function loginRedirect(reason='expired') {
  if (leaving) return;
  leaving=true;
  const icon=currentIcon()?.id;
  clearPrivateView();
  const query=new URLSearchParams({reason});
  if (icon) query.set('icon',icon);
  location.replace(`/teacher/login?${query}`);
}

function applySession(value) {
  session=value;
  clearTimeout(expiryTimer);
  expiryTimer=setTimeout(()=>loginRedirect(),Math.max(0,value.remainingMs));
  $('#session-user').textContent=`${value.username} · 교사 계정`;
  $('#session-expiry').textContent=`${new Date(value.expiresAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})} 자동 로그아웃`;
}

async function validateSession() {
  try {
    const response=await fetch('/api/teacher/session',{credentials:'same-origin',cache:'no-store'});
    if (response.status===401) { loginRedirect(); return false; }
    if (!response.ok) throw new Error();
    applySession(await response.json());
    return true;
  } catch {
    clearPrivateView();
    loading.hidden=false;
    loading.textContent='서버 연결을 확인할 수 없어 수식 화면을 잠갔습니다. 연결을 확인하고 새로고침해 주세요.';
    return false;
  }
}

function makeDrawing(icon) {
  let grid='';
  for (let value=-8;value<=8;value+=1) {
    const position=320+value*36, className=value===0?'axis':'gridline';
    grid+=`<line class="${className}" x1="${position}" y1="32" x2="${position}" y2="608"/>`;
    grid+=`<line class="${className}" x1="32" y1="${position}" x2="608" y2="${position}"/>`;
    if (value!==0 && value%2===0) {
      grid+=`<text class="gridtext" text-anchor="middle" x="${position}" y="335">${value}</text>`;
      grid+=`<text class="gridtext" text-anchor="end" x="312" y="${320-value*36+4}">${value}</text>`;
    }
  }
  grid+='<text class="gridtext" x="309" y="335">0</text><text class="gridtext" x="611" y="324">x</text><text class="gridtext" x="317" y="25">y</text>';
  // The SVG is the existing, trusted application drawing, not user-uploaded HTML.
  return `<svg viewBox="0 0 640 640" role="img" aria-label="${escapeHTML(icon.name)} 좌표평면">${grid}<g transform="translate(320,320) scale(36,-36)">${icon.svg}</g></svg>`;
}

function readableEquation(value) {
  return value.replace(/\^2/g,'²').replace(/>=/g,' ≥ ').replace(/<=/g,' ≤ ')
    .replace(/abs\(([^()]*)\)/g,'|$1|').replace(/-/g,'−')
    .replace(/=/g,' = ').replace(/\+/g,' + ').replace(/\{/g,'  { ').replace(/\}/g,' }');
}

function renderIcon() {
  const icon=currentIcon();
  if (!icon) return;
  selectedPart=-1;
  $('#drawing-title').textContent=icon.name;
  $('#drawing-subtitle').textContent=icon.subtitle;
  $('#part-count').textContent=`${icon.parts.length}개 부분`;
  $('#equation-count').textContent=`총 ${icon.parts.reduce((sum,part)=>sum+part.equations.length,0)}개 식`;
  drawing.innerHTML=makeDrawing(icon);
  chips.innerHTML=icon.parts.map((part,index)=>`<button class="part-chip" type="button" data-select-part="${index}" aria-pressed="false">${index+1}. ${escapeHTML(part.name)}</button>`).join('');
  parts.innerHTML=icon.parts.map((part,index)=>{
    const equations=part.equations.map((equation,row)=>`<div class="formula-display">${escapeHTML(readableEquation(equation))}</div><div class="copy-row"><code>${escapeHTML(equation)}</code><button class="button compact" type="button" data-copy-part="${index}" data-copy-row="${row}" aria-label="${escapeHTML(part.name)} 수식 복사">식 복사</button></div>`).join('');
    return `<article class="part-card" id="part-${index}"><div class="part-header"><button class="part-title" type="button" data-select-part="${index}"><span class="part-number">${String(index+1).padStart(2,'0')}</span>${escapeHTML(part.name)}</button><span class="kind-tag">${escapeHTML(part.kindLabel)}</span></div>${equations}<p class="part-description">${escapeHTML(part.description)}</p></article>`;
  }).join('');
  $('#selected-note').textContent='부분 이름을 누르면 그림에서 강조됩니다.';
  statusBox.textContent='';
  const url=new URL(location.href);
  url.searchParams.set('icon',icon.id);
  history.replaceState(null,'',url.pathname+url.search);
}

function highlightPart(index,scroll=false) {
  const icon=currentIcon();
  if (!icon) return;
  selectedPart=index>=0&&index<icon.parts.length?index:-1;
  const svg=drawing.querySelector('svg');
  svg?.classList.toggle('has-focus',selectedPart>=0);
  drawing.querySelectorAll('[data-part]').forEach(group=>group.classList.toggle('is-focus',Number(group.dataset.part)===selectedPart));
  chips.querySelectorAll('[data-select-part]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.selectPart)===selectedPart)));
  parts.querySelectorAll('.part-card').forEach((card,index)=>card.classList.toggle('is-selected',index===selectedPart));
  $('#selected-note').textContent=selectedPart>=0?`강조한 부분 · ${selectedPart+1}. ${icon.parts[selectedPart].name}`:'전체 그림을 보고 있습니다.';
  if (scroll && selectedPart>=0) $(`#part-${selectedPart}`)?.scrollIntoView({behavior:'smooth',block:'nearest'});
}

async function loadData() {
  if (loadingData || leaving) return;
  loadingData=true;
  try {
    const response=await fetch('/api/teacher/data',{credentials:'same-origin',cache:'no-store'});
    if (response.status===401) { loginRedirect(); return; }
    if (!response.ok) throw new Error();
    const data=await response.json();
    if (!Array.isArray(data.icons)||!data.icons.length) throw new Error();
    icons=data.icons;
    applySession(data);
    select.replaceChildren(...icons.map(icon=>{
      const option=document.createElement('option');
      option.value=icon.id; option.textContent=icon.name;
      return option;
    }));
    const requested=new URLSearchParams(location.search).get('icon');
    if (icons.some(icon=>icon.id===requested)) select.value=requested;
    renderIcon();
    loading.hidden=true;
    workspace.hidden=false;
  } catch {
    clearPrivateView();
    loading.hidden=false;
    loading.textContent='수식 자료를 불러오지 못했습니다. 서버 연결을 확인하고 새로고침해 주세요.';
  } finally { loadingData=false; }
}

function allEquations(icon) {
  // Formula-only lines: do not prepend Korean labels to text pasted into a graph.
  return icon.parts.flatMap(part=>part.equations).join('\n');
}

async function copyText(text) {
  if (!await validateSession()) return;
  try {
    await navigator.clipboard.writeText(text);
    statusBox.textContent='수식을 복사했습니다. Desmos의 식 입력칸에 붙여넣으세요.';
  } catch {
    $('#copy-manual').value=text;
    $('#copy-dialog').showModal();
    $('#copy-manual').focus();
    $('#copy-manual').select();
  }
}

async function logout(destination) {
  if (leaving) return;
  const csrf=session?.csrfToken;
  // Remove rendered/private data immediately, including any copy fallback.
  clearPrivateView();
  loading.hidden=false;
  loading.textContent='로그아웃하고 있습니다…';
  try {
    const response=await fetch('/api/teacher/logout',{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json','X-CSRF-Token':csrf||''},body:'{}',
    });
    if (!response.ok) throw new Error();
    channel?.postMessage({type:'logout'});
    leaving=true;
    location.replace(destination);
  } catch {
    loading.textContent='서버와 통신하지 못해 로그아웃 완료를 확인할 수 없습니다. 연결 후 새로고침하여 다시 로그아웃해 주세요.';
  }
}

select.addEventListener('change',renderIcon);
$('#reset-highlight').addEventListener('click',()=>highlightPart(-1));
chips.addEventListener('click',event=>{
  const button=event.target.closest('[data-select-part]');
  if (button) highlightPart(Number(button.dataset.selectPart));
});
drawing.addEventListener('click',event=>{
  const group=event.target.closest('[data-part]');
  if (group) highlightPart(Number(group.dataset.part),true);
});
parts.addEventListener('click',event=>{
  const selectButton=event.target.closest('[data-select-part]');
  if (selectButton) highlightPart(Number(selectButton.dataset.selectPart));
  const copyButton=event.target.closest('[data-copy-part]');
  if (!copyButton) return;
  const part=currentIcon()?.parts[Number(copyButton.dataset.copyPart)];
  const equation=part?.equations[Number(copyButton.dataset.copyRow)];
  if (equation) copyText(equation);
});
$('#copy-all').addEventListener('click',()=>{
  const icon=currentIcon();
  if (icon) copyText(allEquations(icon));
});
$('#download').addEventListener('click',async()=>{
  if (!await validateSession()) return;
  const icon=currentIcon();
  if (!icon) return;
  const text=`[교사용 모범식 · 학생 배포 금지]\n${icon.name}\n\n`+
    icon.parts.map((part,index)=>`${index+1}. ${part.name}\n${part.equations.join('\n')}\n${part.description}`).join('\n\n')+
    '\n\n--- 식만 모아 보기 ---\n'+allEquations(icon);
  const url=URL.createObjectURL(new Blob(['\uFEFF',text],{type:'text/plain;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;link.download=`${icon.id}-teacher-equations.txt`;
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  statusBox.textContent='수식 파일을 저장했습니다. 이 파일은 학생에게 공유하지 마세요.';
});
$('#print').addEventListener('click',async()=>{
  if (await validateSession()) window.print();
});
$('#logout').addEventListener('click',()=>logout('/teacher/login?reason=logout'));
$('#student-view').addEventListener('click',()=>logout('/'));
channel?.addEventListener('message',event=>{
  if (event.data?.type==='logout') loginRedirect('logout');
});
window.addEventListener('pagehide',clearPrivateView);
window.addEventListener('pageshow',event=>{ if (event.persisted) loadData(); });
document.addEventListener('visibilitychange',async()=>{
  if (document.hidden) { workspace.hidden=true; return; }
  if (!icons.length) { loadData(); return; }
  if (await validateSession()) workspace.hidden=false;
});
setInterval(()=>{if (!document.hidden&&icons.length) validateSession();},60000);
loadData();
