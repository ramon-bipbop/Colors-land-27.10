import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Store} from '../src/store.js';
import {Service} from '../src/service.js';
import {makeServer} from '../src/server.js';
import {PortalPayments,readReceipt,receiptMaxBytes} from '../src/portal-payments.js';
import {PortalDemo} from '../src/portal-demo.js';
import {Readable} from 'node:stream';
import {deviceType,duplicateDeviceTypes,addCalendarMonths} from '../public/portal-model.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jzgAAAABJRU5ErkJggg==','base64');
const details={recipient:'Тестовый получатель',bank:'Тестовый банк',requisites:'ТЕСТ — НЕ ПЕРЕВОДИТЬ',note:'Тест'};
function model(t){const s=new Store(':memory:');t.after(()=>s.close());const payments=new PortalPayments(s),portal=new PortalDemo({store:s,payments}),headers={};const res={setHeader:(k,v)=>headers[k]=v};const session=portal.session({headers:{}},res);portal.ensureAccount(session);portal.save(session);return {s,payments,portal,session,cookie:headers['Set-Cookie'].split(';')[0]};}
test('Типы определяются осторожно: Android TV и планшеты не становятся телефонами',()=>{
 assert.equal(deviceType({name:'iPhone',platform:'iOS'}),'phone');
 assert.equal(deviceType({name:'MacBook',platform:'macOS'}),'computer');
 assert.equal(deviceType({name:'Android TV',platform:'Android'}),'tv');
 assert.equal(deviceType({name:'iPad',platform:'iOS'}),'tablet');
 assert.equal(deviceType({platform:'Android'}),null);
 assert.deepEqual(duplicateDeviceTypes([{name:'iPhone'},{name:'Телефон Android'},{name:'MacBook'}]),[{type:'phone',count:2,label:'Телефоны'}]);
 assert.deepEqual(duplicateDeviceTypes([{name:'iPhone'},{name:'MacBook'},{name:'Android TV'},{platform:'Android'}]),[]);
});
test('Чек не выдаёт доступ; очередь и сессия переживают пересоздание серверных объектов',t=>{
 const {s,payments,portal,session,cookie}=model(t),row=payments.create(session,'m3',{bytes:png,mime:'image/png',name:'тест.png'});
 assert.equal(row.status,'review');assert.equal(row.plan.price,550);assert.equal(row.plan.deviceLimit,3);assert.equal(session.subscription,null);
 assert.equal(row.bytes,undefined);assert.equal(row.owner,undefined);
 assert.throws(()=>payments.create(session,'m1',{bytes:png,mime:'image/png',name:'ещё.png'}),/уже отправлен/);
 const restarted=new PortalDemo({store:s,payments:new PortalPayments(s)}),state=restarted.handle('/api/portal/session','GET',{}, {headers:{cookie}}, {setHeader(){}});
 assert.equal(state.payment.id,row.id);assert.equal(state.payment.status,'review');assert.equal(state.subscription,null);
 payments.review(row.id,'approve','', 'admin',portal);
 const approved=portal.find(session.key);assert.equal(approved.subscription.deviceLimit,3);assert.equal(approved.subscription.devicesUsed,0);
 const end=approved.subscription.expiresAt;
 assert.throws(()=>payments.review(row.id,'approve','','admin',portal),/уже принято/);assert.equal(portal.find(session.key).subscription.expiresAt,end);
 const again=payments.create(approved,'m1',{bytes:png,mime:'image/png',name:'продление.png'});payments.review(again.id,'approve','','admin',portal);
 assert.equal(portal.find(session.key).subscription.expiresAt,addCalendarMonths(end,1).toISOString());
});
test('Отказ требует причины и оставляет подписку без изменений',t=>{
 const {payments,portal,session}=model(t);const row=payments.create(session,'m1',{bytes:png,mime:'image/png',name:'чек.png'});
 assert.throws(()=>payments.review(row.id,'reject','','admin',portal),/причину/);
 const rejected=payments.review(row.id,'reject','Перевод не найден','admin',portal);assert.equal(rejected.status,'rejected');assert.equal(portal.find(session.key).subscription,null);
});
test('Проверяются содержимое, MIME и размер, имя файла очищается',async()=>{
 const req=(bytes,headers)=>Object.assign(Readable.from([bytes]),{headers});
 await assert.rejects(()=>readReceipt(req(Buffer.from('<svg/>'),{'content-type':'image/png'})),/формате/);
 await assert.rejects(()=>readReceipt(req(png,{'content-type':'application/pdf'})),/содержимому/);
 await assert.rejects(()=>readReceipt(req(png,{'content-type':'image/png','content-length':receiptMaxBytes+1})),/10 МБ/);
 const file=await readReceipt(req(png,{'content-type':'image/png','x-receipt-name':encodeURIComponent('../<check>.png')}));assert.equal(file.name,'check.png');
});
test('HTTP: чек доступен администратору, в другой сессии не виден; чужой Origin запрещён',async t=>{
 const s=new Store(':memory:'),settings={value:JSON.parse(readFileSync(new URL('../config/demo.json',import.meta.url))),readiness:()=>null},service=new Service(s,settings,['admin']);service.user('demo-user');
 const server=makeServer(service,{demo:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));s.close();});
 const base='http://127.0.0.1:'+server.address().port,initial=await fetch(base+'/api/portal/session'),cookie=initial.headers.get('set-cookie').split(';')[0];
 const headers={cookie,'content-type':'image/png','x-receipt-name':encodeURIComponent('тест.png'),'x-plan-id':'m3','x-price-quote':'550'};
 assert.equal((await fetch(base+'/api/portal/demo/receipt',{method:'POST',headers:{...headers,'x-price-quote':'699'},body:png})).status,409);
 const sent=await fetch(base+'/api/portal/demo/receipt',{method:'POST',headers,body:png});assert.equal(sent.status,200);const result=await sent.json();
 const state=await (await fetch(base+'/api/portal/session',{headers:{cookie}})).json();assert.equal(state.payment.status,'review');assert.equal(state.subscription,null);
 const stranger=await (await fetch(base+'/api/portal/session')).json();assert.equal(stranger.payment,null);
 assert.equal((await fetch(base+'/api/portal/demo/receipt',{method:'POST',headers:{...headers,origin:'https://evil.example'},body:png})).status,403);
 const admin=await (await fetch(base+'/api/state')).json();assert.ok(admin.portalReceipts.some(r=>r.id===result.payment.id));
 const file=await fetch(base+'/api/portal-receipts/'+result.payment.id+'/file');assert.equal(file.headers.get('content-type'),'application/octet-stream');assert.match(file.headers.get('content-disposition'),/^attachment;/);assert.deepEqual(Buffer.from(await file.arrayBuffer()),png);
 const settingsResult=await fetch(base+'/api/portal-payment-settings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(details)});assert.equal(settingsResult.status,200);
 assert.equal((await (await fetch(base+'/api/portal/session',{headers:{cookie}})).json()).paymentDetails.ready,true);
});
