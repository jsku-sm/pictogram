'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {createServer}=require('../server');
const {buildTeacherData,readAppData,lineEquation,pathEquations,pathPoints,attributes}=require('../geometry');
const PASSWORD='test-only-randomized-classroom-secret-2026';
const USER='teacher';

async function withServer(options,run) {
  const server=createServer({password:PASSWORD,username:USER,hostIsSecure:false,publicOrigin:'',...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try { await run(base); }
  finally {
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
}
async function login(base,overrides={},headers={}) {
  return fetch(`${base}/api/teacher/login`,{
    method:'POST',headers:{'Content-Type':'application/json',...headers},
    body:JSON.stringify({username:USER,password:PASSWORD,...overrides}),
  });
}
async function authenticated(base) {
  const response=await login(base);
  assert.equal(response.status,200);
  return {cookie:response.headers.get('set-cookie').split(';')[0],body:await response.json()};
}
function evaluate(expression,x,y) {
  const code=expression.replace(/\^/g,'**').replace(/(\d)([xy])/g,'$1*$2').replace(/\)([xy])/g,')*$1');
  // Test-only evaluation of expressions generated from this fixed, trusted dataset.
  return new Function('x','y',`return (${code});`)(x,y);
}
function equationHolds(equation,x,y,tolerance=0.00015) {
  const raw=equation.split('{')[0];
  if (/^\(/.test(raw) && !raw.includes('=')) {
    const [px,py]=raw.slice(1,-1).split(',').map(Number);
    return Math.abs(x-px)<tolerance&&Math.abs(y-py)<tolerance;
  }
  const [left,right]=raw.split('=');
  return Math.abs(evaluate(left,x,y)-evaluate(right,x,y))<tolerance;
}
function regionContains(model,x,y) {
  if (model.type!=='arc') return true;
  const r=model.region;
  if (r.type==='top-wedge') return y-r.cy>=Math.abs(x-r.cx)-0.0001;
  const v=r.axis==='x'?x:y;
  return r.op==='>='?v>=r.value-0.0001:v<=r.value+0.0001;
}

test('horizontal, vertical, sloped and rational line equations retain their bounds',()=>{
  assert.equal(lineEquation(1,0,5,-4),'y=-x+1{1<=x<=5}');
  assert.equal(lineEquation(2,-1,2,4),'x=2{-1<=y<=4}');
  assert.equal(lineEquation(-3,0,3,0),'y=0{-3<=x<=3}');
  assert.equal(lineEquation(-4,-2,-1,2),'y=(4/3)x+10/3{-4<=x<=-1}');
  assert.deepEqual(pathEquations('M0,0 L2,2 M3,0 L3,4'),['y=x{0<=x<=2}','x=3{0<=y<=4}']);
});
test('unknown or invalid paths are rejected instead of generating incorrect answers',()=>{
  assert.throws(()=>pathEquations('M0,0 Q1,2 3,4'));
  assert.throws(()=>lineEquation(NaN,0,2,3));
});
test('all 20 images contain 148 one-per-part model formulas, with unchanged SVGs',()=>{
  const icons=buildTeacherData(), source=readAppData();
  assert.equal(icons.length,20);
  assert.equal(icons.reduce((sum,icon)=>sum+icon.parts.length,0),148);
  for(const [index,icon] of icons.entries()) {
    assert.equal(icon.svg,source.icons[index].svg);
    assert.ok(icon.parts.every(part=>part.equations.length===1));
    for(const part of icon.parts) assert.doesNotMatch(part.equations[0],/NaN|Infinity|undefined|0x|--/);
  }
});
test('all source coordinates satisfy their generated formula and arc restrictions',()=>{
  const source=readAppData(), generated=buildTeacherData();
  let samples=0;
  for(const [index,icon] of source.icons.entries()) {
    const groups=new Map([...icon.svg.matchAll(/<g\b([^>]*)>([\s\S]*?)<\/g>/g)]
      .map(m=>[Number(attributes(m[1])['data-part']),m[2]]));
    for(const [partIndex,part] of generated[index].parts.entries()) {
      const model=part.model,markup=groups.get(partIndex);
      let points=[];
      if(model.type==='arc') {
        const match=markup.match(/<path\b([^>]*?)\/>/);
        points=pathPoints(attributes(match[1]).d)[0];
        assert.ok(model.maxResidual<=0.0001);
      } else if(model.type==='line') {
        points=Array.from({length:9},(_,i)=>[
          model.x1+(model.x2-model.x1)*i/8,model.y1+(model.y2-model.y1)*i/8]);
        const constraint=part.restriction;
        const [low,axis,high]=constraint.split('<=');
        for(const [x,y] of points) assert.ok((axis==='x'?x:y)>=+low-1e-9&&(axis==='x'?x:y)<=+high+1e-9);
      } else if(model.type==='circle') {
        points=Array.from({length:32},(_,i)=>[
          model.cx+model.radius*Math.cos(i*Math.PI/16),
          model.cy+model.radius*Math.sin(i*Math.PI/16)]);
      } else points=[[model.cx,model.cy]];
      for(const [x,y] of points) {
        assert.ok(equationHolds(part.equations[0],x,y),`${icon.id}/${part.name}: ${x},${y}`);
        assert.ok(regionContains(model,x,y),`${icon.id}/${part.name}: invalid range`);
        samples++;
      }
      if (model.type==='arc') {
        const r=model.region;
        const excluded=r.type==='top-wedge'?[model.cx,model.cy-model.radius]:
          r.axis==='y'?[model.cx,model.cy+(r.op==='>='?-model.radius:model.radius)]:
          [model.cx+(r.op==='>='?-model.radius:model.radius),model.cy];
        assert.equal(regionContains(model,...excluded),false);
      }
    }
  }
  assert.equal(samples, 2455);
});
test('semicircles and Wi-Fi arcs are concise; point markers are coordinates, not circles',()=>{
  const icons=Object.fromEntries(buildTeacherData().map(icon=>[icon.id,icon]));
  assert.equal(icons.bell.parts[0].equations[0],'x^2+y^2=9{y>=0}');
  assert.equal(icons.bell.parts[2].equations[0],'x^2+y^2=0.25{y<=0}');
  assert.equal(icons.wifi.parts[0].equations[0],'x^2+(y+2)^2=4{y>=abs(x)-2}');
  assert.equal(icons.wifi.parts[3].equations[0],'(0,-2)');
  assert.equal(icons.monitor.parts[6].equations[0],'(3.5,0.5)');
});
test('student content retains its learning questions and has no model-formula bank',()=>{
  const data=readAppData();
  for(const icon of data.icons) for(const part of icon.parts) {
    assert.ok(part.questions.length);
    assert.equal(part.equations,undefined);
    assert.equal(part.model,undefined);
  }
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  assert.doesNotMatch(html,/\(x\+2\)\^2\+\(y-2\)\^2=25/);
  assert.doesNotMatch(html,/jsku-sm-pictogram-teacher\.onrender\.com/);
  assert.match(html,/teacherLoginHref/);
});

test('student page and separate teacher login page are public, but workspace is gated',async()=>{
  await withServer({},async base=>{
    assert.equal((await fetch(base)).status,200);
    const loginPage=await fetch(`${base}/teacher/login`);
    assert.equal(loginPage.status,200);
    assert.match(await loginPage.text(),/교사용 로그인/);
    const denied=await fetch(`${base}/teacher`,{redirect:'manual'});
    assert.equal(denied.status,303);
    assert.equal(denied.headers.get('location'),'/teacher/login');
    assert.equal((await fetch(`${base}/api/teacher/data`)).status,401);
    assert.equal((await fetch(`${base}/api/teacher/session`)).status,401);
    assert.equal((await fetch(`${base}/teacher.js`)).status,401);
  });
});
test('direct HTML, query role flags, alternate asset paths and forged cookies cannot bypass login',async()=>{
  await withServer({},async base=>{
    for(const route of ['/teacher?role=teacher&loggedIn=true','/teacher/','/teacher.html']) {
      const response=await fetch(base+route,{redirect:'manual',headers:{Cookie:'role=teacher; authenticated=true; picto_teacher_session=forged'}});
      assert.equal(response.status,303);
    }
    for(const route of ['/api/teacher/data?role=teacher','/teacher/teacher.js']) {
      assert.equal((await fetch(base+route,{headers:{Cookie:'picto_teacher_session='+'A'.repeat(43)}})).status,401);
    }
  });
});
test('protected source files, configuration secrets and traversal attempts are never served',async()=>{
  await withServer({},async base=>{
    for(const route of ['/server.js','/geometry.js','/.env','/test/server.test.js','/package.json','/../server.js','/%2e%2e%2fserver.js','/teacher/../geometry.js']) {
      assert.equal((await fetch(base+route)).status,404,route);
    }
    const config=await (await fetch(`${base}/config.js`)).text();
    assert.match(config,/serverMode: true/);
    assert.ok(!config.includes(PASSWORD));
  });
});
test('correct account logs in and returns authenticated formulas without disclosing the password',async()=>{
  await withServer({},async base=>{
    const {cookie,body}=await authenticated(base);
    assert.equal(body.role,'teacher');
    assert.equal(body.username,USER);
    assert.ok(body.csrfToken);
    const page=await fetch(`${base}/teacher`,{headers:{Cookie:cookie}});
    assert.equal(page.status,200);
    assert.match(await page.text(),/그림과 수식/);
    const response=await fetch(`${base}/api/teacher/data`,{headers:{Cookie:cookie}});
    assert.equal(response.status,200);
    assert.match(response.headers.get('cache-control'),/no-store/);
    const data=await response.json();
    assert.equal(data.icons.length,20);
    assert.equal(data.icons[0].parts[0].equations[0],'(x+2)^2+(y-2)^2=25');
    assert.ok(!JSON.stringify(data).includes(PASSWORD));
    assert.equal((await fetch(`${base}/teacher.js`,{headers:{Cookie:cookie}})).status,200);
  });
});
test('wrong username or password never creates an authenticated cookie',async()=>{
  await withServer({},async base=>{
    for(const overrides of [{password:'wrong'},{username:'student'},{username:'',password:''},{password:PASSWORD+'x'}]) {
      const response=await login(base,overrides);
      assert.equal(response.status,401);
      assert.equal(response.headers.get('set-cookie'),null);
    }
  });
});
test('missing and weak server passwords fail closed',async()=>{
  for(const password of ['', '1234']) await withServer({password},async base=>{
    assert.equal((await fetch(base)).status,200);
    assert.equal((await login(base)).status,503);
    assert.equal((await fetch(`${base}/api/teacher/data`)).status,401);
  });
});
test('malformed JSON, null, arrays and oversized input fail without crashing the server',async()=>{
  await withServer({},async base=>{
    for(const body of ['null','[]','{broken','"text"']) {
      const response=await fetch(`${base}/api/teacher/login`,{method:'POST',headers:{'Content-Type':'application/json'},body});
      assert.equal(response.status,400);
    }
    const huge=await fetch(`${base}/api/teacher/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(9000)});
    assert.equal(huge.status,413);
    assert.equal((await login(base,{password:'x'.repeat(513)})).status,400);
    assert.equal((await fetch(`${base}/healthz`)).status,200);
    assert.equal((await login(base)).status,200);
  });
});
test('login throttling survives page refreshes and forged forwarding headers',async()=>{
  await withServer({},async base=>{
    for(let i=0;i<5;i++) assert.equal((await login(base,{password:'wrong'},{'X-Forwarded-For':`192.0.2.${i}`})).status,401);
    await fetch(`${base}/teacher/login`);
    const limited=await login(base,{}, {'X-Forwarded-For':'203.0.113.100'});
    assert.equal(limited.status,429);
    assert.ok(Number(limited.headers.get('retry-after'))>0);
  });
});
test('throttling expires after its server-side time window',async()=>{
  let clock=Date.now();
  await withServer({now:()=>clock},async base=>{
    for(let i=0;i<5;i++) await login(base,{password:'wrong'});
    clock+=15*60*1000+1;
    assert.equal((await login(base)).status,200);
  });
});
test('cross-origin and non-JSON login attempts are rejected',async()=>{
  await withServer({},async base=>{
    assert.equal((await login(base,{}, {Origin:'https://other.example'})).status,403);
    assert.equal((await login(base,{}, {'Sec-Fetch-Site':'same-site'})).status,403);
    const response=await fetch(`${base}/api/teacher/login`,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({username:USER,password:PASSWORD})});
    assert.equal(response.status,415);
    assert.equal((await login(base,{}, {Origin:base})).status,200);
  });
});
test('logout requires the session CSRF token and revokes access including replayed cookies',async()=>{
  await withServer({},async base=>{
    const {cookie,body}=await authenticated(base);
    const request=(csrf)=>fetch(`${base}/api/teacher/logout`,{
      method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:'{}'});
    assert.equal((await request('wrong')).status,403);
    const logout=await request(body.csrfToken);
    assert.equal(logout.status,200);
    assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
    assert.equal((await fetch(`${base}/api/teacher/data`,{headers:{Cookie:cookie}})).status,401);
    assert.equal((await fetch(`${base}/teacher`,{headers:{Cookie:cookie},redirect:'manual'})).status,303);
  });
});
test('session expiry is enforced on the server independently of JavaScript timers',async()=>{
  let clock=Date.now();
  await withServer({now:()=>clock,sessionMs:1000},async base=>{
    const {cookie}=await authenticated(base);
    clock+=1001;
    assert.equal((await fetch(`${base}/api/teacher/data`,{headers:{Cookie:cookie}})).status,401);
  });
});
test('production cookies use HttpOnly, Secure and SameSite=Strict',async()=>{
  await withServer({hostIsSecure:true},async base=>{
    const response=await login(base);
    const cookie=response.headers.get('set-cookie');
    assert.match(cookie,/HttpOnly/);
    assert.match(cookie,/Secure/);
    assert.match(cookie,/SameSite=Strict/);
    assert.match(response.headers.get('strict-transport-security'),/max-age/);
  });
});
test('image selection survives the login redirect without allowing external redirects',async()=>{
  await withServer({},async base=>{
    const selected=await fetch(`${base}/teacher?icon=wifi`,{redirect:'manual'});
    assert.equal(selected.headers.get('location'),'/teacher/login?icon=wifi');
    const malicious=await fetch(`${base}/teacher?icon=https://other.example&next=https://other.example`,{redirect:'manual'});
    assert.equal(malicious.headers.get('location'),'/teacher/login');
  });
});
test('relative login assets work and receive restrictive headers',async()=>{
  await withServer({},async base=>{
    for(const route of ['/teacher/login.js','/teacher/teacher.css','/teacher/config.js']) {
      const response=await fetch(base+route);
      assert.equal(response.status,200);
      assert.match(response.headers.get('x-content-type-options'),/nosniff/);
    }
    const response=await fetch(`${base}/teacher/login`);
    assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    assert.match(response.headers.get('cache-control'),/no-store/);
  });
});
test('a server restart invalidates old sessions',async()=>{
  let cookie;
  await withServer({},async base=>{({cookie}=await authenticated(base));});
  await withServer({},async base=>{
    assert.equal((await fetch(`${base}/api/teacher/data`,{headers:{Cookie:cookie}})).status,401);
  });
});

test('trailing slashes are canonicalized before relative login assets are loaded',async()=>{
  await withServer({},async base=>{
    const response=await fetch(`${base}/teacher/login/?icon=wifi`,{redirect:'manual'});
    assert.equal(response.status,303);
    assert.equal(response.headers.get('location'),'/teacher/login?icon=wifi');
  });
});
test('login form never puts passwords in a URL if JavaScript fails to load',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','teacher-login.html'),'utf8');
  assert.match(html,/<form id="login-form" method="post" action="\/api\/teacher\/login">/);
});
