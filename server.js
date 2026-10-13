'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = __dirname;
const INDEX_PATH = path.join(ROOT, 'index.html');
const TEACHER_PATH = path.join(ROOT, 'teacher.html');
const COOKIE_NAME = 'picto_teacher_session';
const SESSION_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 5;
const loginAttempts = new Map();

function readAppData() {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const match = html.match(/<script id="app-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('app-data JSON was not found in index.html');
  return JSON.parse(match[1]);
}

function numberText(value) {
  const rounded = Number(value.toPrecision(8));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function lineEquation(x1, y1, x2, y2) {
  if (Math.abs(x2 - x1) < 1e-10) {
    const low = Math.min(y1, y2);
    const high = Math.max(y1, y2);
    return `x=${numberText(x1)}{${numberText(low)}<=y<=${numberText(high)}}`;
  }
  const slope = (y2 - y1) / (x2 - x1);
  const intercept = y1 - slope * x1;
  const slopeText = Math.abs(slope) === 1 ? '' : numberText(Math.abs(slope));
  const interceptText = numberText(Math.abs(intercept));
  const equation = `y=${slope < 0 ? '-' : ''}${slopeText}x${intercept === 0 ? '' : `${intercept < 0 ? '-' : '+'}${interceptText}`}`;
  const low = Math.min(x1, x2);
  const high = Math.max(x1, x2);
  return `${equation}{${numberText(low)}<=x<=${numberText(high)}}`;
}

function pathEquations(data) {
  const tokens = data.match(/[MLZ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || [];
  const equations = [];
  let current = null;
  let start = null;
  for (let i = 0; i < tokens.length;) {
    const command = tokens[i++];
    if (command === 'Z' || command === 'z') {
      if (current && start && (current.x !== start.x || current.y !== start.y)) {
        equations.push(lineEquation(current.x, current.y, start.x, start.y));
      }
      current = start;
      continue;
    }
    if (command !== 'M' && command !== 'L') throw new Error(`Unsupported SVG path command: ${command}`);
    const x = Number(tokens[i++]);
    const y = Number(tokens[i++]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid SVG path coordinates');
    const next = { x, y };
    if (command === 'M') {
      current = next;
      start = next;
    } else {
      if (!current) throw new Error('SVG path must begin with M');
      equations.push(lineEquation(current.x, current.y, next.x, next.y));
      current = next;
    }
  }
  return equations;
}

function attributes(source) {
  return Object.fromEntries([...source.matchAll(/([\w:-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
}

function shapeEquations(markup) {
  const result = [];
  const shapePattern = /<(circle|line|path)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
  for (const match of markup.matchAll(shapePattern)) {
    const [, type, rawAttributes, inner = ''] = match;
    const attrs = attributes(rawAttributes);
    if (type === 'circle') {
      const x = Number(attrs.cx);
      const y = Number(attrs.cy);
      const radius = Number(attrs.r);
      const xTerm = x < 0 ? `x+${numberText(Math.abs(x))}` : `x-${numberText(x)}`;
      const yTerm = y < 0 ? `y+${numberText(Math.abs(y))}` : `y-${numberText(y)}`;
      result.push(`(${xTerm})^2+(${yTerm})^2=${numberText(radius * radius)}`);
    } else if (type === 'line') {
      result.push(lineEquation(Number(attrs.x1), Number(attrs.y1), Number(attrs.x2), Number(attrs.y2)));
    } else {
      const pathData = attrs.d || attributes(inner).d;
      if (pathData) result.push(...pathEquations(pathData));
    }
  }
  return result;
}

function buildTeacherData(data = readAppData()) {
  return data.icons.map(icon => {
    const parts = icon.parts.map(part => ({ name: part.name, equations: [] }));
    for (const group of icon.svg.matchAll(/<g\b([^>]*)>([\s\S]*?)<\/g>/g)) {
      const attrs = attributes(group[1]);
      const part = parts[Number(attrs['data-part'])];
      if (part) part.equations.push(...shapeEquations(group[2]));
    }
    return { id: icon.id, name: icon.name, svg: icon.svg, parts };
  });
}

function safePasswordMatch(candidate, expected) {
  const candidateHash = crypto.createHash('sha256').update(candidate).digest();
  const expectedHash = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(candidateHash, expectedHash);
}

function sign(value, password) {
  return crypto.createHmac('sha256', password).update(value).digest('base64url');
}

function makeSession(password, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: now + SESSION_MS, nonce: crypto.randomBytes(16).toString('base64url') })).toString('base64url');
  return `${payload}.${sign(payload, password)}`;
}

function cookieValue(cookieHeader, name) {
  const cookies = Object.fromEntries((cookieHeader || '').split(';').map(item => {
    const separator = item.indexOf('=');
    return separator < 0 ? [item.trim(), ''] : [item.slice(0, separator).trim(), item.slice(separator + 1).trim()];
  }));
  return cookies[name] || '';
}

function validSession(cookieHeader, password, now = Date.now(), activeSessions) {
  const token = cookieValue(cookieHeader, COOKIE_NAME);
  if (!token) return false;
  if (activeSessions && !activeSessions.has(token)) return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  const expected = Buffer.from(sign(payload, password));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(session.exp) && session.exp > now;
  } catch {
    return false;
  }
}

function send(response, status, body, contentType = 'application/json; charset=utf-8', extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  response.end(body);
}

async function readBody(request, limit = 8192) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function rateLimited(ip, now = Date.now()) {
  const previous = loginAttempts.get(ip) || { count: 0, resetAt: now + LOGIN_WINDOW_MS };
  if (previous.resetAt <= now) {
    previous.count = 0;
    previous.resetAt = now + LOGIN_WINDOW_MS;
  }
  previous.count += 1;
  loginAttempts.set(ip, previous);
  for (const [key, attempt] of loginAttempts) if (attempt.resetAt <= now) loginAttempts.delete(key);
  return previous.count > LOGIN_LIMIT;
}

function createServer({ password = process.env.TEACHER_PASSWORD, hostIsSecure = process.env.NODE_ENV === 'production' } = {}) {
  const teacherData = buildTeacherData();
  const activeSessions = new Set();
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const authenticated = password && validSession(request.headers.cookie, password, Date.now(), activeSessions);

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const body = fs.readFileSync(INDEX_PATH);
      return send(response, 200, body, 'text/html; charset=utf-8');
    }
    if (request.method === 'GET' && url.pathname === '/teacher') {
      const body = fs.readFileSync(TEACHER_PATH);
      return send(response, 200, body, 'text/html; charset=utf-8', {
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      });
    }
    if (request.method === 'GET' && url.pathname === '/teacher.js') {
      const body = fs.readFileSync(path.join(ROOT, 'teacher.js'));
      return send(response, 200, body, 'text/javascript; charset=utf-8');
    }
    if (request.method === 'POST' && url.pathname === '/api/teacher/login') {
      const ip = request.socket.remoteAddress || 'unknown';
      if (rateLimited(ip)) return send(response, 429, JSON.stringify({ error: '잠시 후 다시 시도해 주세요.' }));
      if (!password) return send(response, 503, JSON.stringify({ error: '서버에 교사용 비밀번호가 설정되지 않았습니다.' }));
      let body;
      try {
        body = JSON.parse(await readBody(request));
      } catch {
        return send(response, 400, JSON.stringify({ error: '요청 형식을 확인해 주세요.' }));
      }
      const candidate = typeof body.password === 'string' ? body.password.slice(0, 512) : '';
      if (!safePasswordMatch(candidate, password)) return send(response, 401, JSON.stringify({ error: '비밀번호가 올바르지 않습니다.' }));
      for (const token of activeSessions) if (!validSession(`${COOKIE_NAME}=${token}`, password)) activeSessions.delete(token);
      const token = makeSession(password);
      activeSessions.add(token);
      const cookie = `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${hostIsSecure ? '; Secure' : ''}`;
      return send(response, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8', { 'Set-Cookie': cookie });
    }
    if (request.method === 'POST' && url.pathname === '/api/teacher/logout') {
      activeSessions.delete(cookieValue(request.headers.cookie, COOKIE_NAME));
      return send(response, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8', {
        'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${hostIsSecure ? '; Secure' : ''}`,
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/teacher/data') {
      if (!authenticated) return send(response, 401, JSON.stringify({ error: '교사 인증이 필요합니다.' }));
      return send(response, 200, JSON.stringify(teacherData), 'application/json; charset=utf-8');
    }
    return send(response, 404, JSON.stringify({ error: '찾을 수 없습니다.' }));
  });
}

if (require.main === module) {
  const password = process.env.TEACHER_PASSWORD || '';
  if (password.length < 14) {
    console.error('TEACHER_PASSWORD 환경 변수에 14자 이상의 비밀번호를 설정해 주세요.');
    process.exit(1);
  }
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3000);
  createServer({ password }).listen(port, host, () => {
    console.log(`학생용: http://${host}:${port}/`);
    console.log(`교사용: http://${host}:${port}/teacher`);
  });
}

module.exports = { buildTeacherData, createServer, lineEquation, pathEquations, validSession };
