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
    app = createAccounts(options.adminEmail?{ADMIN_EMAIL:options.adminEmail}:{}, {filename, transport:options.transport || transport});
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
    assert.equal(registration.body.requiresVerification,true);
    const confirmation=await request('auth/verify',{email,code:code(email)});
    assert.equal(confirmation.status,200);
    return {...confirmation,registration};
  };
  return {request,code,verified,filename,restart:async()=>{await stop();await start();}};
}

test('registration requires email verification and creates a session after valid code',async t=>{
  const f=await fixture(t);
  const registration=await f.verified('alumno@example.com');
  assert.equal(registration.registration.body.requiresVerification,true);
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
  const f=await fixture(t);
  for (const fields of [{firstNames:''},{paternalSurname:''},{maternalSurname:''},{confirmPassword:'OtraClave!'}]) {
    assert.equal((await f.request('auth/register',{email:'invalid@example.com',password:'MiClave123!',...fields})).status,400);
  }
  for (const password of ['Abc!1','Abcdefghijklmno!','abcdef!','Abcdef1','Abcde ']) {
    assert.equal((await f.request('auth/register',{email:'invalid@example.com',password})).status,400);
  }
  for (const [email,password] of [['min@example.com','Abcde!'],['max@example.com','Abcdefghijklmn!']]) {
    const result=await f.request('auth/register',{email,password});
    assert.equal(result.status,201);
    assert.equal(result.body.requiresVerification,true);
    assert.equal((await f.request('auth/verify',{email,code:f.code(email)})).status,200);
    assert.equal((await f.request('auth/register',{email:email.toUpperCase(),password})).status,409);
  }
  assert.equal((await f.request('auth/verify',{email:'min@example.com',code:'123456'})).status,400);
});

test('role routes protect organizer, administrator and event publication flows',async t=>{
  const f=await fixture(t,{adminEmail:'admin@example.com'});
  assert.deepEqual((await f.request('events',null,'','GET')).body.events,[]);
  assert.equal((await f.request('venues',{name:'Sala',city:'Mérida',zones:[{name:'General',capacity:60}]})).status,403);
  const admin=await f.verified('admin@example.com'),organizer=await f.verified('organizer@example.com');
  const venue=await f.request('venues',{name:'Teatro Central',city:'Mérida',zones:[{name:'Luneta',type:'seat',capacity:40,rows:5,seatsPerRow:8,accessible:4,seats:Array.from({length:40},(_,i)=>`R${i+1}`)},{name:'General',type:'general',capacity:100,accessible:0,seats:[]}]},admin.cookie);
  assert.equal(venue.status,201);
  const venueList=await f.request('venues',null,admin.cookie,'GET');assert.equal(venueList.body.venues[0].zones.length,2);
  assert.equal((await f.request('auth/organizer-request',{},organizer.cookie)).status,200);
  assert.equal((await f.request('events',{name:'Concierto',zones:[{name:'General',price:200,capacity:60}]},organizer.cookie)).status,403);
  assert.equal((await f.request('admin/organizers',null,admin.cookie,'GET')).body.users.length,1);
  assert.equal((await f.request('admin/organizers',{userId:organizer.body.user.id,approve:true},admin.cookie,'PUT')).status,200);
  assert.equal((await f.request('organizer/venues',null,organizer.cookie,'GET')).body.venues.length,1);
  const draft=await f.request('events',{name:'Concierto',date:'2026-11-01',zones:[{name:'General',price:200,capacity:60}]},organizer.cookie);
  assert.equal(draft.status,200);
  assert.equal((await f.request(`events/${draft.body.id}/submit`,{},organizer.cookie)).status,200);
  assert.equal((await f.request('events',null,'','GET')).body.events.length,0);
  assert.equal((await f.request(`events/${draft.body.id}/decision`,{approve:true},admin.cookie)).status,200);
  assert.equal((await f.request('events',null,'','GET')).body.events.length,1);
  const sale={id:'dynamic-sale',eventId:Number(draft.body.id),total:232,time:new Date().toISOString(),tickets:[{seat:'Acceso 1',owner:'Comprador',code:'dynamic-ticket',transferred:false}]};
  assert.equal((await f.request('orders',{orders:[sale]},organizer.cookie,'PUT')).status,200);
  assert.equal((await f.request('events',{id:draft.body.id,name:'Concierto editado',date:'2026-11-01',hour:'20:00',functions:[{id:'1',date:'2026-11-01',hour:'20:00'}],zones:[{name:'General',price:250,capacity:60}]},organizer.cookie)).status,409);
  assert.equal((await f.request(`events/${draft.body.id}/delete`,{},organizer.cookie)).status,409);
  // Gate access needs box-office staff assigned to the function; codes a buyer saves by hand are not tickets.
  const scan=(code)=>f.request('scan',{code,eventId:draft.body.id,functionId:'1',gate:'Puerta 1'},organizer.cookie);
  assert.equal((await scan('missing')).status,403);
  assert.equal((await f.request('admin/users',{userId:organizer.body.user.id,role:'taquilla'},admin.cookie,'PUT')).status,200);
  assert.equal((await scan('missing')).status,403);
  assert.equal((await f.request(`events/${draft.body.id}/staff`,{userId:organizer.body.user.id,functionId:'1'},admin.cookie)).status,200);
  assert.equal((await scan('missing')).body.result,'invalid');
  assert.equal((await scan('dynamic-ticket')).body.result,'invalid');
  const held=(await f.request('holds',{eventId:draft.body.id,functionId:'1',zone:'General',quantity:1},admin.cookie)).body.hold;
  const paid=await f.request('payments/charge',{holdId:held.id,token:'tok_sandbox_ok',last4:'4242',idempotencyKey:'ik-role-routes'},admin.cookie);
  assert.equal((await scan(paid.body.order.tickets[0].code)).body.result,'valid');
  assert.equal((await scan(paid.body.order.tickets[0].code)).body.result,'used');
  const applicant=await f.verified('applicant@example.com');await f.request('auth/organizer-request',{},applicant.cookie);
  assert.equal((await f.request('admin/organizers',{userId:applicant.body.user.id,approve:false},admin.cookie,'PUT')).status,400);
  assert.equal((await f.request('admin/organizers',{userId:applicant.body.user.id,approve:false,reason:'Faltan datos de contacto.'},admin.cookie,'PUT')).status,200);
  assert.equal((await f.request('auth/me',null,applicant.cookie,'GET')).body.user.organizerReason,'Faltan datos de contacto.');
});

test('password recovery replaces the old password and five failed logins lock the account',async t=>{
  const f=await fixture(t),account=await f.verified('recover@example.com');
  assert.equal((await f.request('auth/forgot',{email:'recover@example.com'})).status,200);
  const resetCode=f.code('recover@example.com');
  assert.equal((await f.request('auth/reset',{email:'recover@example.com',code:resetCode,password:'NuevaClave123!'})).status,200);
  assert.equal((await f.request('auth/login',{email:'recover@example.com',password:'MiClave123!'})).status,401);
  assert.equal((await f.request('auth/login',{email:'recover@example.com',password:'NuevaClave123!'})).status,200);
  for(let i=0;i<5;i++)await f.request('auth/login',{email:'recover@example.com',password:'Incorrecta!'});
  assert.equal((await f.request('auth/login',{email:'recover@example.com',password:'NuevaClave123!'})).status,423);
  assert.ok(account.cookie);
});

test('published events enforce each function and zone, reserved seats, courtesy blocks, capacity and sale windows',async t=>{
  const f=await fixture(t,{adminEmail:'admin@example.com'}),admin=await f.verified('admin@example.com'),organizer=await f.verified('organizer@example.com'),buyer=await f.verified('buyer@example.com');
  assert.equal((await f.request('auth/organizer-request',{},organizer.cookie)).status,200);
  assert.equal((await f.request('admin/organizers',{userId:organizer.body.user.id,approve:true},admin.cookie,'PUT')).status,200);
  const functions=[{id:'matinee',date:'2026-11-20',hour:'15:00'},{id:'evening',date:'2026-11-20',hour:'20:00'}];
  const zones=[{name:'Luneta',type:'seat',price:500,capacity:2,seats:['A1','A2'],accessible:['A1'],blockedSeats:['A2'],rows:1,seatsPerRow:2},{name:'General',type:'general',price:250,capacity:1,seats:[],accessible:[]}];
  const draft=await f.request('events',{name:'Obra',date:functions[0].date,hour:functions[0].hour,functions,zones,ticketLimit:2,saleStart:'2026-10-01T00:00',saleEnd:'2026-12-01T00:00'},organizer.cookie);
  assert.equal(draft.status,200);
  await f.request(`events/${draft.body.id}/submit`,{},organizer.cookie);
  await f.request(`events/${draft.body.id}/decision`,{approve:true},admin.cookie);
  assert.equal((await f.request('organizer/venues',null,buyer.cookie,'GET')).status,403);
  const order=(id,functionId,zone,tickets)=>({id,eventId:Number(draft.body.id),functionId,zone,total:100,time:new Date().toISOString(),tickets});
  const ticket=(seat,code)=>({seat,owner:'Buyer',code,transferred:false});
  assert.equal((await f.request('orders',{orders:[order('blocked-seat','matinee','Luneta',[ticket('A2','blocked')])]},buyer.cookie,'PUT')).status,409);
  assert.equal((await f.request('orders',{orders:[order('matinee-sale','matinee','Luneta',[ticket('A1','matinee-a1')])]},buyer.cookie,'PUT')).status,200);
  assert.equal((await f.request('orders',{orders:[order('evening-sale','evening','Luneta',[ticket('A1','evening-a1')])]},organizer.cookie,'PUT')).status,200);
  assert.equal((await f.request('orders',{orders:[order('matinee-duplicate','matinee','Luneta',[ticket('A1','duplicate-a1')])]},organizer.cookie,'PUT')).status,409);
  assert.equal((await f.request('orders',{orders:[order('invalid-function','invalid','General',[ticket('Acceso 1','invalid-fn')])]},organizer.cookie,'PUT')).status,400);
});
