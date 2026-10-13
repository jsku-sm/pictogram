'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { buildTeacherData, createServer, lineEquation, pathEquations } = require('../server');

const password = 'test-only-teacher-password-2026';
let server;
let baseUrl;

before(async () => {
  server = createServer({ password });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test('geometry conversion creates bounded Desmos equations', () => {
  assert.equal(lineEquation(1, 0, 5, -4), 'y=-x+1{1<=x<=5}');
  assert.equal(lineEquation(2, -1, 2, 4), 'x=2{-1<=y<=4}');
  assert.deepEqual(pathEquations('M0,0 L2,2 M3,0 L3,4'), ['y=x{0<=x<=2}', 'x=3{0<=y<=4}']);
});

test('all 20 icons retain their drawing and receive equations for each shape part', () => {
  const icons = buildTeacherData();
  assert.equal(icons.length, 20);
  assert.ok(icons.every(icon => icon.svg && icon.parts.every(part => part.equations.length > 0)));
  assert.ok(icons.reduce((total, icon) => total + icon.parts.reduce((sum, part) => sum + part.equations.length, 0), 0) > 1000);
  assert.ok(icons.flatMap(icon => icon.parts.flatMap(part => part.equations)).every(equation => !/NaN|undefined|--\d/.test(equation)));
});

test('teacher equation data requires a valid login session', async () => {
  const denied = await fetch(`${baseUrl}/api/teacher/data`);
  assert.equal(denied.status, 401);

  const badLogin = await fetch(`${baseUrl}/api/teacher/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong-password' }),
  });
  assert.equal(badLogin.status, 401);

  const login = await fetch(`${baseUrl}/api/teacher/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';', 1)[0];
  const response = await fetch(`${baseUrl}/api/teacher/data`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const icons = await response.json();
  assert.equal(icons.length, 20);
  assert.equal(icons[0].parts[0].equations[0], '(x+2)^2+(y-2)^2=25');

  await fetch(`${baseUrl}/api/teacher/logout`, { method: 'POST', headers: { Cookie: cookie } });
});
