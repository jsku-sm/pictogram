'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { promisify } = require('node:util');
const { buildTeacherData, lineEquation, pathEquations } = require('./geometry');

const scrypt = promisify(crypto.scrypt);
const ROOT = __dirname;
const COOKIE_NAME = 'picto_teacher_session';
const SESSION_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 5;
const MAX_BODY_BYTES = 8192;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64*1024*1024 };
const BASE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function equalStrings(a, b) {
  return typeof a === 'string' && typeof b === 'string'
    && crypto.timingSafeEqual(Buffer.from(digest(a),'hex'),Buffer.from(digest(b),'hex'));
}

function cookieValue(header, name = COOKIE_NAME) {
  if (typeof header !== 'string') return '';
  for (const item of header.split(';')) {
    const separator=item.indexOf('=');
    if (separator>=0 && item.slice(0,separator).trim()===name) return item.slice(separator+1).trim();
  }
  return '';
}

function send(response, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  response.writeHead(status, {
    'Content-Type':type,
    'Cache-Control':'no-store, max-age=0',
    'Pragma':'no-cache',
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY',
    'Referrer-Policy':'no-referrer',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy':BASE_CSP,
    ...extra,
  });
  response.end(body);
}

function json(response,status,data,headers={}) {
  return send(response,status,JSON.stringify(data),'application/json; charset=utf-8',headers);
}

function redirect(response,location) {
  return send(response,303,'','text/plain; charset=utf-8',{Location:location});
}

async function readBody(request) {
  const sizeHeader=Number(request.headers['content-length']||0);
  if (sizeHeader>MAX_BODY_BYTES) {
    request.resume();
    throw Object.assign(new Error('요청 내용이 너무 큽니다.'),{status:413});
  }
  const chunks=[];
  let size=0;
  for await (const chunk of request) {
    size+=chunk.length;
    if (size>MAX_BODY_BYTES) throw Object.assign(new Error('요청 내용이 너무 큽니다.'),{status:413});
    chunks.push(chunk);
  }
  try {
    const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data!=='object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw Object.assign(new Error('요청 형식을 확인해 주세요.'),{status:400});
  }
}

function createServer({
  password=process.env.TEACHER_PASSWORD || '',
  username=process.env.TEACHER_USERNAME || 'teacher',
  hostIsSecure=process.env.NODE_ENV==='production',
  publicOrigin=process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || '',
  sessionMs=SESSION_MS,
  now=Date.now,
}={}) {
  const configured=typeof password==='string' && password.length>=14 && password.length<=512
    && typeof username==='string' && username.trim().length>0 && username.length<=80;
  username=String(username).trim();
  const salt=crypto.randomBytes(32);
  // No password is bundled in HTML, JavaScript, localStorage, URLs or cookies.
  const passwordHash=configured ? crypto.scryptSync(password,salt,64,SCRYPT_OPTIONS) : null;
  const teacherData=buildTeacherData();
  const ids=new Set(teacherData.map(icon=>icon.id));
  const sessions=new Map(); // SHA-256 of a random 256-bit opaque token -> server-owned identity.
  const attempts=new Map();
  let activeChecks=0;

  function prune() {
    const time=now();
    for (const [key,value] of sessions) if (value.expiresAt<=time) sessions.delete(key);
    for (const [key,value] of attempts) if (value.resetAt<=time) attempts.delete(key);
  }

  function getSession(request) {
    const token=cookieValue(request.headers.cookie);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const key=digest(token), session=sessions.get(key);
    if (!session) return null;
    if (session.expiresAt<=now()) {
      sessions.delete(key);
      return null;
    }
    return {key,...session};
  }

  function sessionJSON(session) {
    return {username:session.username,role:'teacher',expiresAt:session.expiresAt,
      remainingMs:Math.max(0,session.expiresAt-now()),csrfToken:session.csrfToken};
  }

  function cookie(token,maxAge) {
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${hostIsSecure?'; Secure':''}`;
  }

  function sameOrigin(request) {
    if (['cross-site','same-site'].includes(request.headers['sec-fetch-site'])) return false;
    const origin=request.headers.origin;
    if (!origin) return true; // CLI clients still need credentials and, for logout, a CSRF token.
    try {
      const expected=publicOrigin
        ? new URL(publicOrigin).origin
        : `${hostIsSecure?'https':'http'}://${request.headers.host}`;
      return new URL(origin).origin===expected && origin!=='null';
    } catch {
      return false;
    }
  }

  function loginKeys(request,candidateUsername) {
    // Never trust a user-supplied X-Forwarded-For header. Account throttling is
    // shared across clients, so refreshing a page or changing headers cannot reset it.
    return [`account:${digest(candidateUsername.toLowerCase())}`,`ip:${request.socket.remoteAddress||'unknown'}`];
  }

  function limitFor(key) { return key.startsWith('account:')?LOGIN_LIMIT:60; }

  function blockedFor(keys) {
    prune();
    return Math.max(0,...keys.map(key=>{
      const entry=attempts.get(key);
      return entry && entry.count>=limitFor(key) ? entry.resetAt-now() : 0;
    }));
  }

  function recordFailure(keys) {
    for (const key of keys) {
      if (attempts.size>=4096 && !attempts.has(key)) attempts.delete(attempts.keys().next().value);
      const entry=attempts.get(key)||{count:0,resetAt:now()+LOGIN_WINDOW_MS};
      entry.count+=1;
      attempts.set(key,entry);
    }
  }

  function selectedQuery(url) {
    const id=url.searchParams.get('icon');
    return ids.has(id)?`?icon=${encodeURIComponent(id)}`:'';
  }

  const server=http.createServer(async (request,response)=>{
    if (hostIsSecure) response.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      const url=new URL(request.url,'http://localhost');
      const route=url.pathname.replace(/\/+$/,'')||'/';
      const session=getSession(request);
      // Canonicalize page URLs so relative assets also work after a trailing slash.
      if (request.method==='GET' && url.pathname!==route && ['/teacher','/teacher/login'].includes(route)) {
        return redirect(response,route+selectedQuery(url));
      }

      if (request.method==='GET' && route==='/healthz') return send(response,200,'ok','text/plain; charset=utf-8');
      if (request.method==='GET' && (route==='/' || route==='/index.html')) {
        return send(response,200,fs.readFileSync(path.join(ROOT,'index.html')),'text/html; charset=utf-8',{
          'Content-Security-Policy':BASE_CSP.replace("script-src 'self'","script-src 'self' 'unsafe-inline'"),
        });
      }
      if (request.method==='GET' && ['/config.js','/teacher/config.js'].includes(route)) {
        return send(response,200,'window.PICTO_CONFIG = Object.freeze({ serverMode: true, teacherBaseUrl: "" });','text/javascript; charset=utf-8');
      }
      if (request.method==='GET' && route==='/teacher-login.html') return redirect(response,`/teacher/login${selectedQuery(url)}`);
      if (request.method==='GET' && route==='/teacher.html') return redirect(response,`/teacher${selectedQuery(url)}`);

      if (request.method==='GET' && route==='/teacher/login') {
        if (session) return redirect(response,`/teacher${selectedQuery(url)}`);
        return send(response,200,fs.readFileSync(path.join(ROOT,'teacher-login.html')),'text/html; charset=utf-8');
      }

      if (request.method==='GET' && route==='/teacher') {
        if (!session) return redirect(response,`/teacher/login${selectedQuery(url)}`);
        return send(response,200,fs.readFileSync(path.join(ROOT,'teacher.html')),'text/html; charset=utf-8');
      }

      const assetRoute=route.startsWith('/teacher/')?route.slice('/teacher'.length):route;
      if (request.method==='GET' && ['/login.js','/teacher.css','/teacher.js'].includes(assetRoute)) {
        if (assetRoute==='/teacher.js' && !session) return json(response,401,{error:'교사 로그인이 필요합니다.'});
        const type=assetRoute.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8';
        return send(response,200,fs.readFileSync(path.join(ROOT,assetRoute.slice(1))),type);
      }

      if (request.method==='POST' && route.startsWith('/api/teacher/')) {
        if (!sameOrigin(request)) return json(response,403,{error:'허용되지 않은 출처의 요청입니다.'});
        if (!(request.headers['content-type']||'').toLowerCase().startsWith('application/json')) {
          return json(response,415,{error:'JSON 요청만 허용됩니다.'});
        }
      }

      if (request.method==='POST' && route==='/api/teacher/login') {
        if (!configured) return json(response,503,{error:'교사 로그인이 아직 설정되지 않았습니다. 관리자에게 TEACHER_PASSWORD 환경 변수(14자 이상) 설정을 요청해 주세요.'});
        const body=await readBody(request);
        const candidateUsername=typeof body.username==='string'?body.username.trim():'';
        const candidate=typeof body.password==='string'?body.password:'';
        if (candidateUsername.length>80 || candidate.length>512) return json(response,400,{error:'입력 길이를 확인해 주세요.'});
        const keys=loginKeys(request,candidateUsername);
        const blocked=blockedFor(keys);
        if (blocked) return json(response,429,{error:'로그인을 여러 번 실패했습니다. 잠시 후 다시 시도해 주세요.',retryAfter:Math.ceil(blocked/1000)},{'Retry-After':String(Math.ceil(blocked/1000))});
        if (activeChecks>=4) return json(response,429,{error:'요청이 많습니다. 잠시 후 다시 시도해 주세요.'},{'Retry-After':'3'});
        // Count in-flight guesses too; parallel requests cannot exceed the limit.
        recordFailure(keys);
        activeChecks+=1;
        let candidateHash;
        try { candidateHash=await scrypt(candidate,salt,64,SCRYPT_OPTIONS); }
        finally { activeChecks-=1; }
        const passwordOK=crypto.timingSafeEqual(candidateHash,passwordHash);
        const usernameOK=equalStrings(candidateUsername,username);
        if (!passwordOK || !usernameOK) return json(response,401,{error:'아이디 또는 비밀번호가 올바르지 않습니다.'});
        // Successful authentication does not consume the failure allowance.
        for (const key of keys) {
          if (key.startsWith('account:')) attempts.delete(key);
          else {
            const entry=attempts.get(key);
            if (entry) { entry.count=Math.max(0,entry.count-1); if (!entry.count) attempts.delete(key); }
          }
        }
        prune();
        if (session) sessions.delete(session.key);
        if (sessions.size>=2000) return json(response,503,{error:'접속이 많습니다. 잠시 후 다시 시도해 주세요.'});
        const token=crypto.randomBytes(32).toString('base64url');
        const identity={username,role:'teacher',expiresAt:now()+sessionMs,csrfToken:crypto.randomBytes(32).toString('base64url')};
        sessions.set(digest(token),identity);
        return json(response,200,{ok:true,...sessionJSON(identity)},{'Set-Cookie':cookie(token,Math.ceil(sessionMs/1000))});
      }

      if (request.method==='GET' && route==='/api/teacher/session') {
        if (!session) return json(response,401,{error:'교사 로그인이 필요합니다.'});
        return json(response,200,sessionJSON(session));
      }

      if (request.method==='POST' && route==='/api/teacher/logout') {
        if (session && !equalStrings(request.headers['x-csrf-token'],session.csrfToken)) {
          return json(response,403,{error:'로그아웃 요청을 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요.'});
        }
        if (session) sessions.delete(session.key);
        return json(response,200,{ok:true},{'Set-Cookie':cookie('',0)});
      }

      if (request.method==='GET' && route==='/api/teacher/data') {
        if (!session) return json(response,401,{error:'교사 로그인이 필요합니다.'});
        return json(response,200,{icons:teacherData,...sessionJSON(session)});
      }

      // Deliberate allowlist: never serve server.js, geometry.js, .env, source
      // maps, tests, archives or arbitrary paths as static files.
      return json(response,404,{error:'찾을 수 없는 주소입니다.'});
    } catch (error) {
      if (response.headersSent) return response.destroy();
      return json(response,error.status||500,{
        error:error.status?error.message:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
  });
  server.requestTimeout=15000;
  server.headersTimeout=10000;
  server.keepAliveTimeout=5000;
  const timer=setInterval(prune,60000);
  timer.unref();
  server.on('close',()=>clearInterval(timer));
  return server;
}

if (require.main===module) {
  const host=process.env.HOST||'127.0.0.1';
  const port=Number(process.env.PORT||3000);
  if (!Number.isInteger(port)||port<1||port>65535) throw new Error('Invalid PORT');
  if (!process.env.TEACHER_PASSWORD || process.env.TEACHER_PASSWORD.length<14) {
    console.warn('교사 로그인은 잠겨 있습니다. TEACHER_PASSWORD를 14자 이상으로 설정하고 다시 시작하세요.');
  }
  createServer().listen(port,host,()=>{
    console.log(`학생 화면: http://${host}:${port}/`);
    console.log(`교사 로그인: http://${host}:${port}/teacher/login`);
  });
}

module.exports={createServer,buildTeacherData,lineEquation,pathEquations,COOKIE_NAME,SESSION_MS};
