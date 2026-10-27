import { randomBytes,createHash } from 'node:crypto';
import { plans,addCalendarMonths,defaultDeviceLimit } from '../public/portal-model.js';
// Isolated preview sessions. Production identity and subscription data belong to Vanya's backend.
export class PortalDemo {
  constructor({store=null,payments=null}={}){this.sessions=new Map();this.store=store;this.payments=payments;if(store)store.db.exec('CREATE TABLE IF NOT EXISTS portal_demo_sessions(key TEXT PRIMARY KEY,value TEXT NOT NULL)');}
  find(key){return this.store?JSON.parse(this.store.one('SELECT value FROM portal_demo_sessions WHERE key=?',key)?.value??'null'):this.sessions.get(key);}
  save(s){if(this.store)this.store.run('INSERT INTO portal_demo_sessions VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',s.key,JSON.stringify(s));else this.sessions.set(s.key,s);}
  ensureAccount(s){s.account??={id:randomBytes(8).toString('hex'),telegram:{id:'0',name:'Демо-пользователь',username:'colors_preview'}};}
  session(req,res){
    const cookie=(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('colors_preview='))?.slice(15);
    const key=cookie&&/^[\w-]{32}$/.test(cookie)?createHash('sha256').update(cookie).digest('hex'):null;
    let s=key&&this.find(key);
    if(!s||s.until<Date.now()){
      if(this.sessions.size>500)for(const [k,v]of this.sessions)if(v.until<Date.now())this.sessions.delete(k);
      if(this.sessions.size>1000)throw Error('Слишком много демонстрационных сессий');
      const id=randomBytes(24).toString('base64url');s={key:createHash('sha256').update(id).digest('hex'),until:Date.now()+7*86400000,account:null,subscription:null};this.save(s);
      res.setHeader('Set-Cookie',`colors_preview=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);
    }
    return s;
  }
  handle(path,method,body,req,res){
    const s=this.session(req,res);
    try {
    if(path==='/api/portal/session'&&method==='GET')return {preview:true,account:s.account,subscription:s.subscription,payment:this.payments?.latest(s.key)??null,paymentDetails:this.payments?.settings()??null,paymentReady:false,source:'demo'};
    if(path==='/api/portal/demo/activate'&&method==='POST'){
      const p=plans.find(p=>p.id===body.planId);if(!p)throw Error('Тариф не найден');
      this.ensureAccount(s);
      const start=new Date();s.subscription={status:'ACTIVE',planId:p.id,expiresAt:addCalendarMonths(start,p.months).toISOString(),devicesUsed:1,deviceLimit:defaultDeviceLimit,devices:[{name:'iPhone',platform:'iOS · Incy',type:'phone',registered:true}],subscriptionUrl:'https://demo.invalid/colors/personal-subscription',syncedAt:start.toISOString()};
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
      else if(body.scenario==='devices-full'){s.subscription.devices=[{name:'iPhone',type:'phone',platform:'iOS · Incy',registered:true},{name:'MacBook',type:'computer',platform:'macOS · Incy',registered:true},{name:'Android TV',type:'tv',platform:'Android TV · Incy',registered:true}];s.subscription.devicesUsed=3;}
      else if(body.scenario==='duplicate-phones'){s.subscription.devices=[{name:'iPhone',type:'phone',platform:'iOS · Incy',registered:true},{name:'Телефон Android',type:'phone',platform:'Android · Incy',registered:true}];s.subscription.devicesUsed=2;}
      else throw Error('Сценарий не найден');
      return {ok:true};
    }
    if(path==='/api/portal/demo/logout'&&method==='POST'){s.account=null;s.subscription=null;return {ok:true};}
    throw Error('Маршрут не найден');
    } finally {this.save(s);}
  }
}
