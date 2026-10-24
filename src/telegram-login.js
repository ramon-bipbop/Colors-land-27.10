import {randomBytes,createHash,createPublicKey,verify,timingSafeEqual} from 'node:crypto';
const ISSUER='https://oauth.telegram.org',hash=s=>createHash('sha256').update(s).digest('hex'),random=()=>randomBytes(32).toString('base64url');
const cookie=(req,key)=>(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(key+'='))?.slice(key.length+1);
const same=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};

export function verifyTelegramIdToken(token,{clientId,nonce,keys,now=Date.now()}){
  if(typeof token!=='string'||token.length>32768)throw Error('Недействительный ID token');
  const chunks=token.split('.');if(chunks.length!==3||chunks.some(c=>!c||!/^[A-Za-z0-9_-]+$/.test(c)))throw Error('Недействительный JWT');
  const header=JSON.parse(Buffer.from(chunks[0],'base64url')),claims=JSON.parse(Buffer.from(chunks[1],'base64url'));
  if(header.alg!=='RS256'||!header.kid)throw Error('Поддерживается только подпись RS256');
  const jwk=keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig')&&(!k.alg||k.alg==='RS256'));
  if(!jwk||!verify('RSA-SHA256',Buffer.from(chunks[0]+'.'+chunks[1]),createPublicKey({key:jwk,format:'jwk'}),Buffer.from(chunks[2],'base64url')))throw Error('Подпись Telegram не подтверждена');
  const seconds=Math.floor(now/1000),aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(claims.iss!==ISSUER||!aud.includes(String(clientId))||(aud.length>1&&claims.azp!==String(clientId)))throw Error('Неверный issuer или audience');
  if(!Number.isFinite(claims.exp)||claims.exp<=seconds||!Number.isFinite(claims.iat)||claims.iat>seconds+30||claims.iat<seconds-600)throw Error('Токен просрочен или имеет неверное время');
  if(!same(claims.nonce,nonce))throw Error('Неверный nonce');
  // OIDC sub and Telegram numeric id are different claims. Never substitute sub for id.
  const id=typeof claims.id==='number'?String(claims.id):claims.id;
  if(typeof id!=='string'||!/^\d{1,16}$/.test(id)||!Number.isSafeInteger(Number(id))||Number(id)<=0||!claims.sub)throw Error('Нет подтверждённого Telegram ID');
  return {id,name:String(claims.name??claims.given_name??'Пользователь').slice(0,100),username:String(claims.preferred_username??'').slice(0,64)};
}

export class TelegramLogin {
  constructor(store,{clientId='',clientSecret='',publicOrigin='',fetcher=fetch,clock=()=>Date.now()}={}){
    this.s=store;this.clientId=String(clientId);this.clientSecret=clientSecret;this.fetcher=fetcher;this.clock=clock;this.keys=null;this.keysUntil=0;
    this.publicOrigin=publicOrigin.replace(/\/$/,'');this.enabled=false;
    if(this.clientId&&this.clientSecret&&this.publicOrigin){const u=new URL(this.publicOrigin);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('PUBLIC_ORIGIN должен быть HTTPS origin');if(!/^\d+$/.test(this.clientId))throw Error('Неверный TELEGRAM_CLIENT_ID');this.enabled=true;}
    this.s.db.exec(`CREATE TABLE IF NOT EXISTS web_oauth_attempts(state_hash TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,verifier TEXT NOT NULL,nonce TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS web_login_sessions(token_hash TEXT PRIMARY KEY,identity TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS web_session_expiry ON web_login_sessions(expires);`);
  }
  get callbackUrl(){return this.publicOrigin+'/auth/telegram/callback';}
  start(req,res){
    if(!this.enabled)throw Error('Telegram Login ещё не настроен');
    const now=this.clock();this.s.run('DELETE FROM web_oauth_attempts WHERE expires<=?',now);this.s.run('DELETE FROM web_login_sessions WHERE expires<=?',now);
    if(this.s.one('SELECT count(*) n FROM web_oauth_attempts').n>=1000)throw Error('Слишком много попыток входа. Повторите позже.');
    const previous=cookie(req,'colors_oauth');if(previous)this.s.run('DELETE FROM web_oauth_attempts WHERE browser_hash=?',hash(previous));
    const state=random(),browser=random(),verifier=random(),nonce=random();
    this.s.run('INSERT INTO web_oauth_attempts VALUES(?,?,?,?,?)',hash(state),hash(browser),verifier,nonce,now+300000);
    res.setHeader('Set-Cookie',`colors_oauth=${browser}; HttpOnly; Secure; SameSite=Lax; Path=/auth/telegram; Max-Age=300`);
    const url=new URL(ISSUER+'/auth');for(const [k,v] of Object.entries({client_id:this.clientId,redirect_uri:this.callbackUrl,response_type:'code',scope:'openid profile',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}))url.searchParams.set(k,v);
    return url.href;
  }
  async callback(req,res,url){
    if(!this.enabled)throw Error('Telegram Login ещё не настроен');
    const state=url.searchParams.get('state'),browser=cookie(req,'colors_oauth');
    if(!state||state.length>256||!browser)throw Error('Нет подтверждения исходной сессии');
    const attempt=this.s.transaction(()=>{
      const a=this.s.one('SELECT * FROM web_oauth_attempts WHERE state_hash=?',hash(state));
      if(!a||a.expires<=this.clock()||!same(a.browser_hash,hash(browser)))throw Error('Попытка входа не подтверждена');
      this.s.run('DELETE FROM web_oauth_attempts WHERE state_hash=?',hash(state));return a;
    });
    const code=url.searchParams.get('code');if(url.searchParams.has('error')||!code||code.length>4096)throw Error('Вход отменён или код не получен');
    const r=await this.fetcher(ISSUER+'/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:'Basic '+Buffer.from(this.clientId+':'+this.clientSecret).toString('base64')},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:this.callbackUrl,client_id:this.clientId,code_verifier:attempt.verifier}),redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw Error('Telegram не подтвердил вход');const tokens=await r.json();
    if(!this.keys||this.keysUntil<=this.clock()){
      const jwks=await this.fetcher(ISSUER+'/.well-known/jwks.json',{redirect:'error',signal:AbortSignal.timeout(10000)});
      if(!jwks.ok)throw Error('Не удалось проверить подпись Telegram');const data=await jwks.json();if(!Array.isArray(data.keys)||data.keys.length>50)throw Error('Неверный JWKS');this.keys=data.keys;this.keysUntil=this.clock()+300000;
    }
    const telegram=verifyTelegramIdToken(tokens.id_token,{clientId:this.clientId,nonce:attempt.nonce,keys:this.keys,now:this.clock()});
    const session=random();this.s.run('INSERT INTO web_login_sessions VALUES(?,?,?)',hash(session),JSON.stringify({id:'telegram:'+telegram.id,telegram}),this.clock()+7*86400000);
    res.setHeader('Set-Cookie',[
      `colors_session=${session}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`,
      'colors_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/auth/telegram; Max-Age=0'
    ]);
  }
  account(req){const token=cookie(req,'colors_session');if(!token||token.length>256)return null;const s=this.s.one('SELECT identity FROM web_login_sessions WHERE token_hash=? AND expires>?',hash(token),this.clock());return s?JSON.parse(s.identity):null;}
  logout(req,res){const token=cookie(req,'colors_session');if(token)this.s.run('DELETE FROM web_login_sessions WHERE token_hash=?',hash(token));res.setHeader('Set-Cookie','colors_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');}
}
