'use strict';

const loginForm = document.querySelector('#login');
const loginError = document.querySelector('#login-error');
const workspace = document.querySelector('#workspace');
const iconSelect = document.querySelector('#icon-select');
const drawing = document.querySelector('#drawing');
const partsElement = document.querySelector('#parts');
const copyStatus = document.querySelector('#copy-status');
const logoutButton = document.querySelector('#logout');
let icons = [];

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function makeDrawing(icon) {
  let grid = '';
  for (let value = -8; value <= 8; value += 1) {
    const position = 320 + value * 36;
    const axis = value === 0 ? 'axis' : 'gridline';
    grid += `<line class="${axis}" x1="${position}" y1="32" x2="${position}" y2="608"/>`;
    grid += `<line class="${axis}" x1="32" y1="${position}" x2="608" y2="${position}"/>`;
    if (value !== 0 && value % 2 === 0) {
      grid += `<text class="gridtext" text-anchor="middle" x="${position}" y="335">${value}</text>`;
      grid += `<text class="gridtext" text-anchor="end" x="312" y="${320 - value * 36 + 4}">${value}</text>`;
    }
  }
  grid += '<text class="gridtext" x="309" y="335">0</text><text class="gridtext" x="611" y="324">x</text><text class="gridtext" x="317" y="25">y</text>';
  return `<svg viewBox="0 0 640 640" role="img" aria-label="${escapeHtml(icon.name)} 좌표평면 위 그림"><style>.shape{stroke:#193a47;stroke-width:.11;fill:none;stroke-linecap:round;stroke-linejoin:round}.gridline{stroke:#e3eae6;stroke-width:1}.axis{stroke:#84999c;stroke-width:1.5}.gridtext{fill:#637780;font:18px sans-serif}</style>${grid}<g transform="translate(320,320) scale(36,-36)">${icon.svg}</g></svg>`;
}

function allFormulas(icon) {
  return icon.parts.flatMap(part => part.equations.map(equation => `${part.name}: ${equation}`)).join('\n');
}

function renderIcon() {
  const icon = icons.find(item => item.id === iconSelect.value);
  if (!icon) return;
  document.querySelector('#drawing-title').textContent = icon.name;
  drawing.innerHTML = makeDrawing(icon);
  partsElement.innerHTML = icon.parts.map((part, partIndex) => {
    const equations = part.equations;
    const rows = equations.length
      ? `<ol class="formula-list">${equations.map((equation, index) => `<li><span class="index">${index + 1}</span><code>${escapeHtml(equation)}</code></li>`).join('')}</ol>`
      : '<p class="empty">이 부분의 별도 수식이 없습니다.</p>';
    return `<details class="part"><summary>${escapeHtml(part.name)} <span class="count">${equations.length}개 식</span></summary><div class="part-body"><div class="part-actions"><button class="button" type="button" data-copy-part="${partIndex}">이 부분 식 복사</button></div>${rows}</div></details>`;
  }).join('');
  copyStatus.textContent = '';
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    copyStatus.textContent = '복사했습니다.';
  } catch {
    copyStatus.textContent = '브라우저에서 복사가 허용되지 않았습니다.';
  }
}

async function loadTeacherData() {
  const response = await fetch('/api/teacher/data', { cache: 'no-store' });
  if (!response.ok) return false;
  icons = await response.json();
  loginForm.hidden = true;
  workspace.hidden = false;
  logoutButton.hidden = false;
  iconSelect.replaceChildren(...icons.map(icon => {
    const option = document.createElement('option');
    option.value = icon.id;
    option.textContent = icon.name;
    return option;
  }));
  renderIcon();
  return true;
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginError.textContent = '';
  const password = new FormData(loginForm).get('password');
  try {
    const response = await fetch('/api/teacher/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '로그인에 실패했습니다.');
    document.querySelector('#password').value = '';
    if (!await loadTeacherData()) throw new Error('교사용 자료를 불러오지 못했습니다.');
  } catch (error) {
    loginError.textContent = error.message;
  }
});

iconSelect.addEventListener('change', renderIcon);
partsElement.addEventListener('click', event => {
  const button = event.target.closest('[data-copy-part]');
  if (!button) return;
  const icon = icons.find(item => item.id === iconSelect.value);
  const part = icon?.parts[Number(button.dataset.copyPart)];
  if (part) copyText(part.equations.join('\n'));
});
document.querySelector('#copy-all').addEventListener('click', () => {
  const icon = icons.find(item => item.id === iconSelect.value);
  if (icon) copyText(allFormulas(icon));
});
logoutButton.addEventListener('click', async () => {
  await fetch('/api/teacher/logout', { method: 'POST' });
  icons = [];
  workspace.hidden = true;
  logoutButton.hidden = true;
  loginForm.hidden = false;
  loginForm.reset();
  loginError.textContent = '로그아웃했습니다.';
});

loadTeacherData();
