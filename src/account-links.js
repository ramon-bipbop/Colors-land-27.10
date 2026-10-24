import { randomBytes, createHash } from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
// Integration primitive for Vanya's backend; NOT a browser endpoint.
// Persist these records and enforce unique Telegram IDs in the shared DB for production.
export class AccountLinks {
  constructor(clock=()=>Date.now()){this.clock=clock;this.records=new Map();this.telegramOwners=new Map();this.accountTelegram=new Map();}
  create(authenticatedAccountId){
    if(!authenticatedAccountId)throw Error('Нужен авторизованный аккаунт');
    const token=randomBytes(24).toString('base64url');this.records.set(hash(token),{owner:String(authenticatedAccountId),expires:this.clock()+300000,telegram:null,used:false});return token;
  }
  record(token){const r=this.records.get(hash(token));if(!r||r.used||r.expires<=this.clock())throw Error('Ссылка истекла или уже использована');return r;}
  stageFromVerifiedBot(token,verifiedTelegramIdentity){
    const r=this.record(token),id=String(verifiedTelegramIdentity.id);
    if(!/^\d+$/.test(id))throw Error('Неверный Telegram ID');
    if(r.telegram&&r.telegram.id!==id)throw Error('Запрос уже подтверждён другим аккаунтом Telegram');
    const owner=this.telegramOwners.get(id);if(owner&&owner!==r.owner)throw Error('Telegram уже связан с другим аккаунтом');
    const current=this.accountTelegram.get(r.owner);if(current&&current!==id)throw Error('У аккаунта уже есть привязанный Telegram');
    r.telegram={id,name:String(verifiedTelegramIdentity.name??'').slice(0,100)};
  }
  inspect(token,authenticatedAccountId){const r=this.record(token);if(r.owner!==String(authenticatedAccountId))throw Error('Нет доступа к запросу');return r.telegram;}
  confirmOnWebsite(token,authenticatedAccountId){
    const r=this.record(token);if(r.owner!==String(authenticatedAccountId)||!r.telegram)throw Error('Привязка не подтверждена');
    const owner=this.telegramOwners.get(r.telegram.id);if(owner&&owner!==r.owner)throw Error('Telegram уже связан с другим аккаунтом');
    const current=this.accountTelegram.get(r.owner);if(current&&current!==r.telegram.id)throw Error('У аккаунта уже есть привязанный Telegram');
    this.telegramOwners.set(r.telegram.id,r.owner);this.accountTelegram.set(r.owner,r.telegram.id);r.used=true;return {accountId:r.owner,telegramId:r.telegram.id};
  }
}
