import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAccounts } from './accounts.js';

async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'eticket-accounts-'));
  const filename = join(dir, 'accounts.sqlite');
  const messages = [];
  const transport = { async sendMail(message) { messages.push(message); return {accepted:[message.to]}; } };
  let app, server, origin;
  async function start() {
    app = createAccounts({}, {filename, ...(options.noMail ? {} : {transport:options.transport || transport})});
    server = createServer((req,res) => app.middleware(req,res,() => {res.statusCode=404;res.end();}));
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    await new Promise(resolve => {server.close(resolve);server.closeAllConnections();});
    app.close();
  }
  await start();
  t.after(async () => {await stop();rmSync(dir,{recursive:true,force:true});});
  const request = async (path, data, cookie='', method='POST', extraHeaders={}) => {
    if (path === 'auth/register') data = {firstNames:data.name || 'Usuario',paternalSurname:'Prueba',maternalSurname:'Usuario',confirmPassword:data.password,...data};
    const response=await fetch(`${origin}/api/${path}`,{
      method,headers:{'Content-Type':'application/json',cookie,...extraHeaders},
      ...(method==='GET'?{}:{body:JSON.stringify(data||{})}),
    });
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  const code = email => messages.filter(m=>m.to===email).at(-1).text.match(/\d{6}/)[0];
  const verified = async email => {
    const registration=await request('auth/register',{email,name:'Usuario',password:'MiClave123!'});
    assert.equal(registration.status,201);
    assert.ok(registration.body.user);
    return registration;
  };
  return {request,code,verified,filename,restart:async()=>{await stop();await start();}};
}

test('registration immediately creates a persistent session without email configuration',async t=>{
  const f=await fixture(t,{noMail:true});
  const registration=await f.verified('alumno@example.com');
  assert.equal(registration.body.requiresVerification,undefined);
  assert.match(registration.cookie,/eticket_session=/);
  await f.restart();
  assert.equal((await f.request('auth/me',null,registration.cookie,'GET')).body.user.email,'alumno@example.com');
  assert.equal((await f.request('auth/login',{email:'alumno@example.com',password:'Incorrecta!'})).status,401);
  assert.equal((await f.request('auth/login',{email:'alumno@example.com',password:'MiClave123!'})).status,200);
  assert.equal((await f.request('auth/logout',{},registration.cookie)).status,200);
  assert.equal((await f.request('auth/me',null,registration.cookie,'GET')).body.user,null);
  const db=new DatabaseSync(f.filename);
  const user=db.prepare('SELECT * FROM users').get();
  assert.notEqual(user.password_hash,'MiClave123!');
  assert.equal(user.verified,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM challenges').get().count,0);db.close();
});

test('users cannot read or overwrite another account orders',async t=>{
  const f=await fixture(t), alice=await f.verified('alice@gmail.com'), bob=await f.verified('bob@outlook.com');
  const order={id:'test-1',eventId:1,total:100,time:new Date().toISOString(),tickets:[{seat:'A1',owner:'Alice',code:'test',transferred:false}]};
  assert.equal((await f.request('orders',{orders:[order]},alice.cookie,'PUT')).status,200);
  assert.deepEqual((await f.request('orders',null,bob.cookie,'GET')).body.orders,[]);
  assert.equal((await f.request('orders',{orders:[order]},'','PUT')).status,401);
  await f.restart();
  assert.deepEqual((await f.request('orders',null,alice.cookie,'GET')).body.orders,[order]);
  assert.deepEqual((await f.request('orders',null,bob.cookie,'GET')).body.orders,[]);
  assert.equal((await f.request('orders',{orders:[order]},alice.cookie,'PUT',{origin:'https://otra-web.test'})).status,403);
});

test('registration validates names, matching passwords, complexity and duplicate emails',async t=>{
  const f=await fixture(t,{noMail:true});
  for (const fields of [{firstNames:''},{paternalSurname:''},{maternalSurname:''},{confirmPassword:'OtraClave!'}]) {
    assert.equal((await f.request('auth/register',{email:'invalid@example.com',password:'MiClave123!',...fields})).status,400);
  }
  for (const password of ['Abc!1','Abcdefghijklmno!','abcdef!','Abcdef1','Abcde ']) {
    assert.equal((await f.request('auth/register',{email:'invalid@example.com',password})).status,400);
  }
  for (const [email,password] of [['min@example.com','Abcde!'],['max@example.com','Abcdefghijklmn!']]) {
    const result=await f.request('auth/register',{email,password});
    assert.equal(result.status,201);
    assert.equal(result.body.user.paternalSurname,'Prueba');
    assert.equal(result.body.user.maternalSurname,'Usuario');
    assert.equal((await f.request('auth/register',{email:email.toUpperCase(),password})).status,409);
  }
  assert.equal((await f.request('auth/verify',{code:'123456'})).status,404);
});
