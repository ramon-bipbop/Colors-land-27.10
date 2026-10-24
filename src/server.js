import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PortalDemo } from './portal-demo.js';
import { TelegramLogin } from './telegram-login.js';
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const files = { '/':['index.html','text/html; charset=utf-8'], '/app.js':['app.js','text/javascript; charset=utf-8'], '/style.css':['style.css','text/css; charset=utf-8'] };
Object.assign(files, {
  '/account': ['index.html','text/html; charset=utf-8'],
  '/account/': ['index.html','text/html; charset=utf-8'],
  '/offer': ['index.html','text/html; charset=utf-8'],
  '/admin': ['admin.html','text/html; charset=utf-8'],
  '/portal.js': ['portal.js','text/javascript; charset=utf-8'],
  '/portal-model.js': ['portal-model.js','text/javascript; charset=utf-8'],
  '/account-ui.js': ['account-ui.js','text/javascript; charset=utf-8'],
  '/portal.css': ['portal.css','text/css; charset=utf-8'],
  '/logo.svg': ['logo.svg','image/svg+xml'],
  '/connect': ['connect.html','text/html; charset=utf-8'],
  '/connect.js': ['connect.js','text/javascript; charset=utf-8'],
  '/connection-card.js': ['connection-card.js','text/javascript; charset=utf-8'],
  '/connection-content.js': ['connection-content.js','text/javascript; charset=utf-8']
});
const equal = (a,b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x,y); };

export function makeServer(v, {demo = false, adminToken = '', host = '127.0.0.1', port = 8787, telegramLogin = {}} = {}) {
  const portal = new PortalDemo();
  const login = new TelegramLogin(v.s,telegramLogin);
  const server = createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status,data) => { res.writeHead(status,{'content-type':'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); };
    try {
      // Bind API to the exact host:port; stops DNS rebinding and cross-origin writes.
      const expected = `${host}:${server.address().port}`;
      const publicHost=login.enabled?new URL(login.publicOrigin).host:null;
      if (req.headers.host !== expected && req.headers.host !== `localhost:${server.address().port}` && req.headers.host!==publicHost) return json(403,{error:'Недопустимый Host'});
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}` && !(login.enabled&&origin===login.publicOrigin)) return json(403,{error:'Недопустимый Origin'});
      const url=new URL(req.url,'http://localhost'),path=url.pathname;
      if(req.method==='GET'&&path==='/auth/telegram/start'){
        if(!login.enabled){res.writeHead(303,{Location:'/account?login=unavailable'});return res.end();}
        res.writeHead(303,{Location:login.start(req,res)});return res.end();
      }
      if(req.method==='GET'&&path==='/auth/telegram/callback'){
        try{await login.callback(req,res,url);res.writeHead(303,{Location:'/account'});}
        catch{res.writeHead(303,{Location:'/account?login=failed'});}
        return res.end();
      }
      if (req.method === 'GET' && files[path]) {
        const [file,type] = files[path]; res.writeHead(200,{'content-type':type}); return res.end(readFileSync(publicDir+file));
      }
      if (req.method === 'GET' && path === '/health') return json(200,{ok:true,mode:demo?'demo':'production'});
      if (req.method === 'GET' && path === '/api/public') return json(200,{demo,brand:v.settings.value.brand,instructions:v.settings.value.instructions,supportUrl:v.settings.value.supportUrl,termsUrl:v.settings.value.termsUrl,privacyUrl:v.settings.value.privacyUrl});
      if (path.startsWith('/api/portal/')) {
        if(path==='/api/portal/session'&&req.method==='GET'){
          const account=login.account(req);
          if(account||!demo)return json(200,{preview:false,account,subscription:null,source:'backend',paymentReady:false,subscriptionReady:false,authReady:login.enabled});
          return json(200,{...portal.handle(path,'GET',{},req,res),authReady:login.enabled});
        }
        if(path==='/api/portal/logout'&&req.method==='POST'){
          if(!req.headers['content-type']?.startsWith('application/json'))return json(415,{error:'Ожидается JSON'});
          login.logout(req,res);return json(200,{ok:true});
        }
        if(!demo)return json(503,{error:'Персональный кабинет ещё не подключён к backend',preview:false});
        if(!['GET','POST'].includes(req.method))return json(405,{error:'Метод не поддерживается'});
        let body={};if(req.method==='POST'){
          if(!req.headers['content-type']?.startsWith('application/json'))return json(415,{error:'Ожидается JSON'});
          let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return json(413,{error:'Слишком большой запрос'});}
          try{body=JSON.parse(raw||'{}');}catch{return json(400,{error:'Некорректный JSON'});}
        }
        return json(200,portal.handle(path,req.method,body,req,res));
      }
      if (!path.startsWith('/api/')) return json(404,{error:'Не найдено'});
      if (!demo && !equal(req.headers.authorization ?? '',`Bearer ${adminToken}`)) return json(401,{error:'Нужен ADMIN_TOKEN'});
      let body = {};
      if (req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) return json(415,{error:'Ожидается application/json'});
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw)>32768) return json(413,{error:'Слишком большой запрос'}); }
        try { body = JSON.parse(raw || '{}'); } catch { return json(400,{error:'Некорректный JSON'}); }
      } else if (req.method !== 'GET') return json(405,{error:'Метод не поддерживается'});
      const actor = v.admins[0];
      if (path === '/api/state' && req.method === 'GET') return json(200,{demo,settings:v.settings.value,readiness:v.settings.readiness(),client:demo?v.snapshot('demo-user'):null,...v.dashboard()});
      if (path === '/api/settings' && req.method === 'POST') {
        v.admin(actor); v.settings.save(body); v.s.log('web-admin','settings_changed','settings'); return json(200,{ok:true});
      }
      if (path === '/api/order' && demo && req.method === 'POST') return json(200,v.create('demo-user',body.planId));
      if (path === '/api/demo-pay' && demo && req.method === 'POST') {
        const o = v.own(body.id,'demo-user'); return json(200,v.paid(o.id,'demo-user','XTR',o.plan.stars,`demo-charge-${o.id}`));
      }
      if (path === '/api/approve' && req.method === 'POST') return json(200,v.approve(body.id,actor));
      if (path === '/api/issue' && req.method === 'POST') return json(200,v.issue(body.id,actor,body.url));
      if (path === '/api/reject' && req.method === 'POST') return json(200,v.reject(body.id,actor,body.reason));
      if (path === '/api/disabled' && req.method === 'POST') { v.disabled(body.userId,actor); return json(200,{ok:true}); }
      if (path === '/api/demo-refund' && demo && req.method === 'POST') return json(200,v.refunded(body.id,actor));
      return json(404,{error:'Не найдено'});
    } catch (e) { return json(400,{error:e.message}); }
  });
  server.requestTimeout=15000; server.headersTimeout=10000;
  return server;
}
