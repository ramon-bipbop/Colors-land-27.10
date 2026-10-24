import { randomBytes } from 'node:crypto';
import { plans,addCalendarMonths } from '../public/portal-model.js';
// Isolated preview sessions. Production identity and subscription data belong to Vanya's backend.
export class PortalDemo {
  constructor(){this.sessions=new Map();}
  session(req,res){
    const key=(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('colors_preview='))?.slice(15);
    let s=key&&this.sessions.get(key);
    if(!s||s.until<Date.now()){
      if(this.sessions.size>500)for(const [k,v]of this.sessions)if(v.until<Date.now())this.sessions.delete(k);
      if(this.sessions.size>1000)throw Error('Слишком много демонстрационных сессий');
      const id=randomBytes(24).toString('base64url');s={until:Date.now()+7*86400000,account:null,subscription:null};this.sessions.set(id,s);
      res.setHeader('Set-Cookie',`colors_preview=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);
    }
    return s;
  }
  handle(path,method,body,req,res){
    const s=this.session(req,res);
    if(path==='/api/portal/session'&&method==='GET')return {preview:true,account:s.account,subscription:s.subscription,paymentReady:false,source:'demo'};
    if(path==='/api/portal/demo/activate'&&method==='POST'){
      const p=plans.find(p=>p.id===body.planId);if(!p)throw Error('Тариф не найден');
      s.account??={id:randomBytes(8).toString('hex'),telegram:{id:'0',name:'Демо-пользователь',username:'colors_preview'}};
      const start=new Date();s.subscription={status:'ACTIVE',planId:p.id,expiresAt:addCalendarMonths(start,p.months).toISOString(),devicesUsed:1,deviceLimit:2,devices:[{name:'iPhone',platform:'iOS · Incy',registered:true}],subscriptionUrl:'https://demo.invalid/colors/personal-subscription',syncedAt:start.toISOString()};
      return {ok:true,preview:true};
    }
    if(path==='/api/portal/demo/telegram'&&method==='POST'){
      if(!s.account)throw Error('Сначала откройте демо-аккаунт');s.account.telegram={name:'Демо-пользователь',username:'colors_preview'};return {ok:true,preview:true};
    }
    if(path==='/api/portal/demo/scenario'&&method==='POST'){
      if(!s.subscription)throw Error('Нет подписки');
      if(body.scenario==='expired')s.subscription.expiresAt=new Date(Date.now()-86400000).toISOString();
      else if(body.scenario==='short')s.subscription.expiresAt=new Date(Date.now()+12*86400000).toISOString();
      else if(body.scenario==='long')s.subscription.expiresAt=addCalendarMonths(Date.now(),15).toISOString();
      else if(body.scenario==='devices-full'){s.subscription.devicesUsed=2;s.subscription.devices.push({name:'MacBook',platform:'macOS · Incy',registered:true});s.subscription.devices=s.subscription.devices.slice(0,2);}
      else throw Error('Сценарий не найден');
      return {ok:true};
    }
    if(path==='/api/portal/demo/logout'&&method==='POST'){s.account=null;s.subscription=null;return {ok:true};}
    throw Error('Маршрут не найден');
  }
}
