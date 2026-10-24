import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {Store} from '../src/store.js';
import {TelegramLogin,verifyTelegramIdToken} from '../src/telegram-login.js';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test-key',use:'sig',alg:'RS256'};
const now=Date.UTC(2026,9,24,12),seconds=Math.floor(now/1000);
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
function token(overrides={},header={alg:'RS256',kid:'test-key'}){
  const data=encode(header)+'.'+encode({iss:'https://oauth.telegram.org',aud:'12345',sub:'oidc-subject-not-telegram-id',id:42,name:'Тест',preferred_username:'test',iat:seconds,exp:seconds+300,nonce:'nonce',...overrides});
  return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url');
}
const options={clientId:'12345',nonce:'nonce',keys:[jwk],now};
test('Telegram ID берётся из подписанного id, а не из sub или username',()=>{
  assert.deepEqual(verifyTelegramIdToken(token(),options),{id:'42',name:'Тест',username:'test'});
  assert.throws(()=>verifyTelegramIdToken(token({id:undefined}),options));
});
test('Проверяются подпись, issuer, audience, nonce, время и алгоритм',()=>{
  for(const claims of [{iss:'https://evil.example'},{aud:'another'},{nonce:'other'},{exp:seconds-1},{iat:seconds+100},{iat:seconds-1000}])assert.throws(()=>verifyTelegramIdToken(token(claims),options));
  const chunks=token().split('.');chunks[1]=encode({id:999});assert.throws(()=>verifyTelegramIdToken(chunks.join('.'),options));
  assert.throws(()=>verifyTelegramIdToken(token({}, {alg:'none',kid:'test-key'}),options));
  assert.throws(()=>verifyTelegramIdToken(token({}, {alg:'RS256',kid:'unknown'}),options));
});
test('OAuth использует PKCE и browser-bound state, создаёт HttpOnly сессию, запрещает replay',async t=>{
  const s=new Store(':memory:');t.after(()=>s.close());let nonce,challenge,sessionCookie;
  const res={headers:{},setHeader(k,v){this.headers[k]=v;}};
  const auth=new TelegramLogin(s,{clientId:'12345',clientSecret:'test-only',publicOrigin:'https://colors.example',clock:()=>now,fetcher:async(url,opts)=>{
    if(url.endsWith('/token')){assert.equal(opts.method,'POST');assert.equal(createHash('sha256').update(opts.body.get('code_verifier')).digest('base64url'),challenge);return {ok:true,json:async()=>({id_token:token({nonce})})};}
    assert.equal(url,'https://oauth.telegram.org/.well-known/jwks.json');return {ok:true,json:async()=>({keys:[jwk]})};
  }});
  const start=new URL(auth.start({headers:{}},res));nonce=start.searchParams.get('nonce');challenge=start.searchParams.get('code_challenge');
  assert.equal(start.searchParams.get('scope'),'openid profile');assert.equal(start.searchParams.get('code_challenge_method'),'S256');
  const browserCookie=res.headers['Set-Cookie'].split(';')[0],callback=new URL('https://colors.example/auth/telegram/callback');callback.searchParams.set('state',start.searchParams.get('state'));callback.searchParams.set('code','test-code');
  await assert.rejects(()=>auth.callback({headers:{cookie:'colors_oauth=wrong'}},res,callback));
  await auth.callback({headers:{cookie:browserCookie}},res,callback);
  const cookies=res.headers['Set-Cookie'];assert.ok(cookies[0].includes('HttpOnly; Secure; SameSite=Lax'));
  sessionCookie=cookies[0].split(';')[0];assert.equal(auth.account({headers:{cookie:sessionCookie}}).telegram.id,'42');
  assert.equal(auth.account({headers:{cookie:'colors_session=forged'}}),null);
  await assert.rejects(()=>auth.callback({headers:{cookie:browserCookie}},res,callback));
  const anotherInstance=new TelegramLogin(s);assert.equal(anotherInstance.account({headers:{cookie:sessionCookie}}).telegram.id,'42');
  auth.logout({headers:{cookie:sessionCookie}},res);assert.equal(auth.account({headers:{cookie:sessionCookie}}),null);
});
test('Без реквизитов вход выключен; HTTP origin и неверные client IDs не принимаются',t=>{
  const s=new Store(':memory:');t.after(()=>s.close());const auth=new TelegramLogin(s);assert.equal(auth.enabled,false);assert.throws(()=>auth.start({headers:{}},{setHeader(){}}));
  assert.throws(()=>new TelegramLogin(s,{clientId:'1',clientSecret:'x',publicOrigin:'http://colors.example'}));
  assert.throws(()=>new TelegramLogin(s,{clientId:'../1',clientSecret:'x',publicOrigin:'https://colors.example'}));
});
