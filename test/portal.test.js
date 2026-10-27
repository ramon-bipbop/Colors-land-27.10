import test from 'node:test';
import assert from 'node:assert/strict';
import {plans,remaining,addCalendarMonths} from '../public/portal-model.js';
import {AccountLinks} from '../src/account-links.js';
import {RemnawaveReader} from '../src/remnawave-reader.js';
import {PortalDemo} from '../src/portal-demo.js';
test('Утверждённые цены за весь период, в рублях',()=>assert.deepEqual(plans.map(p=>[p.months,p.price]),[[1,250],[3,550],[6,990],[12,1850]]));
test('Период до календарного месяца отображается днями, далее — календарно',()=>{
  const now=Date.parse('2026-01-31T10:00:00+03:00');
  assert.equal(remaining('2026-02-28T10:00:00+03:00',now).calendar,false);
  const r=remaining('2027-05-02T10:00:00+03:00',now);assert.deepEqual([r.calendar,r.years,r.months,r.restDays],[true,1,3,2]);
  assert.equal(remaining('2026-01-30T10:00:00+03:00',now).expired,true);
});
test('Календарный месяц, високосный год, конец месяца и московская полночь',()=>{
  assert.equal(addCalendarMonths('2026-01-31T10:00:00+03:00',1).toISOString(),'2026-02-28T07:00:00.000Z');
  assert.equal(addCalendarMonths('2024-01-31T10:00:00+03:00',1).toISOString(),'2024-02-29T07:00:00.000Z');
  assert.equal(addCalendarMonths('2026-01-30T22:30:00Z',1).toISOString(),'2026-02-27T22:30:00.000Z');
});
test('Привязка требует подтверждения бота и исходной веб-сессии; токен одноразовый',()=>{
  const links=new AccountLinks();const token=links.create('site-user');
  assert.ok(token.length<=64);assert.throws(()=>links.confirmOnWebsite(token,'site-user'));
  links.stageFromVerifiedBot(token,{id:123,name:'Пользователь'});
  assert.throws(()=>links.inspect(token,'stranger'));assert.throws(()=>links.confirmOnWebsite(token,'stranger'));
  assert.equal(links.inspect(token,'site-user').id,'123');assert.equal(links.confirmOnWebsite(token,'site-user').telegramId,'123');
  assert.throws(()=>links.confirmOnWebsite(token,'site-user'));
  const second=links.create('other');assert.throws(()=>links.stageFromVerifiedBot(second,{id:123}));
  const third=links.create('site-user');assert.throws(()=>links.stageFromVerifiedBot(third,{id:456}));
});
test('Просроченная ссылка не связывает аккаунты',()=>{let now=0;const l=new AccountLinks(()=>now),t=l.create('a');now=300001;assert.throws(()=>l.stageFromVerifiedBot(t,{id:1}));});
test('Remnawave reader возвращает только разрешённые поля и не подменяет неизвестный счётчик нулём',async()=>{
  const requests=[];const reader=new RemnawaveReader({baseUrl:'https://panel.example',token:'secret',fetcher:async(url,opts)=>{requests.push([url,opts]);if(url.includes('hwid'))return {ok:false,status:503};return {ok:true,json:async()=>({response:{status:'ACTIVE',expireAt:'2027-01-01T00:00:00Z',hwidDeviceLimit:2,subscriptionUrl:'https://sub.example/secret',vlessUuid:'private',trojanPassword:'private'}})};}});
  const s=await reader.subscriptionFor(1);assert.equal(s.devicesUsed,null);assert.equal(s.deviceLimit,2);assert.equal(s.trojanPassword,undefined);assert.equal(s.vlessUuid,undefined);assert.equal(requests[0][1].headers.Authorization,'Bearer secret');
  await assert.rejects(()=>reader.subscriptionFor('../tokens'));
});
test('HWID счётчик использует зарегистрированные устройства',async()=>{
  const r=new RemnawaveReader({baseUrl:'https://panel.example',token:'x',fetcher:async url=>({ok:true,json:async()=>({response:url.includes('hwid')?{devices:[{hwid:'private',deviceModel:'Phone',platform:'iOS'}]}:{status:'ACTIVE',expireAt:'2027-01-01',hwidDeviceLimit:2,subscriptionUrl:'https://sub.example'}})})});
  const s=await r.subscriptionFor(1);assert.equal(s.devicesUsed,1);assert.equal(s.devices[0].hwid,undefined);
});
test('Демо-сессии отделены по HttpOnly cookie, данные не делятся между посетителями',()=>{
  const p=new PortalDemo(),headers={},res={setHeader:(k,v)=>headers[k]=v};const req={headers:{}};
  p.handle('/api/portal/session','GET',{},req,res);const cookie=headers['Set-Cookie'].split(';')[0];assert.ok(headers['Set-Cookie'].includes('HttpOnly'));
  p.handle('/api/portal/demo/activate','POST',{planId:'m3'},{headers:{cookie}},res);
  assert.ok(p.handle('/api/portal/session','GET',{}, {headers:{cookie}},res).subscription);
  assert.equal(p.handle('/api/portal/session','GET',{}, {headers:{}},res).subscription,null);
});
