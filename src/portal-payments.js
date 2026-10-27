import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {plans,defaultDeviceLimit,addCalendarMonths} from '../public/portal-model.js';

export const receiptMaxBytes=10*1024*1024;
export function receiptMime(bytes) {
  if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
  if(bytes.length>=5&&bytes.toString('ascii',0,5)==='%PDF-')return 'application/pdf';
  throw Error('Прикрепите чек в формате JPG, PNG, WebP или PDF.');
}
export async function readReceipt(req) {
  if(Number(req.headers['content-length'])>receiptMaxBytes)throw Error('Размер чека не должен превышать 10 МБ.');
  const chunks=[];let size=0;
  for await(const part of req){size+=part.length;if(size>receiptMaxBytes)throw Error('Размер чека не должен превышать 10 МБ.');chunks.push(part);}
  if(!size)throw Error('Прикрепите файл или фотографию чека.');
  const bytes=Buffer.concat(chunks),mime=receiptMime(bytes);
  if(req.headers['content-type']?.split(';')[0]!==mime)throw Error('Формат файла не соответствует его содержимому.');
  let name;try{name=decodeURIComponent(req.headers['x-receipt-name']??'Чек');}catch{throw Error('Некорректное имя файла.');}
  name=name.split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f<>"']/g,'').slice(0,160)||'Чек';
  return {bytes,mime,name};
}

// Local preview workflow only. Production orders belong to the existing bot backend.
export class PortalPayments {
  constructor(store) {
    this.s=store;
    this.s.db.exec(`CREATE TABLE IF NOT EXISTS portal_receipts(
      id TEXT PRIMARY KEY,owner TEXT NOT NULL,customer TEXT NOT NULL,plan TEXT NOT NULL,
      file_name TEXT NOT NULL,mime TEXT NOT NULL,bytes BLOB NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('review','approved','rejected')),created INTEGER NOT NULL,
      reviewed INTEGER,reviewer TEXT,reason TEXT);
      CREATE INDEX IF NOT EXISTS portal_receipts_owner ON portal_receipts(owner,created);
      CREATE UNIQUE INDEX IF NOT EXISTS portal_receipts_pending ON portal_receipts(owner) WHERE status='review';`);
  }
  settings() {
    const value=JSON.parse(this.s.meta('manual_payment_details')??readFileSync(new URL('../config/manual-payment.json',import.meta.url),'utf8'));
    const result=Object.fromEntries(['recipient','bank','requisites','note'].map(k=>[k,value[k]??'']));
    return {...result,ready:['recipient','bank','requisites'].every(k=>result[k].trim())};
  }
  saveSettings(body,actor) {
    const result={};for(const k of ['recipient','bank','requisites','note']){if(typeof body[k]!=='string'||body[k].length>1000)throw Error('Реквизиты: каждое поле должно быть текстом до 1000 символов.');result[k]=body[k].trim();}
    this.s.transaction(()=>{this.s.setMeta('manual_payment_details',JSON.stringify(result));this.s.log(actor,'manual_payment_settings','portal');});
    return this.settings();
  }
  describe(row) {
    if(!row)return null;
    return {id:row.id,customer:row.customer,plan:JSON.parse(row.plan),fileName:row.file_name,mime:row.mime,status:row.status,createdAt:row.created,reviewedAt:row.reviewed,reason:row.reason};
  }
  latest(owner){return this.describe(this.s.one('SELECT id,customer,plan,file_name,mime,status,created,reviewed,reason FROM portal_receipts WHERE owner=? ORDER BY created DESC,rowid DESC LIMIT 1',owner));}
  list(){return this.s.all('SELECT id,customer,plan,file_name,mime,status,created,reviewed,reason FROM portal_receipts ORDER BY created DESC LIMIT 100').map(r=>this.describe(r));}
  create(session,planId,file) {
    const p=plans.find(p=>p.id===planId);if(!p)throw Error('Тариф не найден.');
    if(!session.account)throw Error('Сначала войдите в аккаунт.');
    if(!file.bytes.length||file.bytes.length>receiptMaxBytes||receiptMime(file.bytes)!==file.mime)throw Error('Некорректный файл чека.');
    return this.s.transaction(()=>{
      if(this.s.one("SELECT id FROM portal_receipts WHERE owner=? AND status='review'",session.key))throw Error('Чек уже отправлен на проверку. Дождитесь решения администратора.');
      if(this.s.one('SELECT count(*) n FROM portal_receipts WHERE owner=? AND created>?',session.key,Date.now()-86400000).n>=10)throw Error('За сегодня отправлено слишком много чеков.');
      if(this.s.one('SELECT coalesce(sum(length(bytes)),0) n FROM portal_receipts').n+file.bytes.length>500*1024*1024)throw Error('Хранилище чеков заполнено. Обратитесь к администратору.');
      const id=randomUUID(),snapshot={...p,deviceLimit:defaultDeviceLimit,currency:'RUB'};
      this.s.run("INSERT INTO portal_receipts(id,owner,customer,plan,file_name,mime,bytes,status,created) VALUES(?,?,?,?,?,?,?,'review',?)",id,session.key,session.account.telegram?.name??'Демо-пользователь',JSON.stringify(snapshot),file.name,file.mime,file.bytes,Date.now());
      this.s.log('portal-demo','receipt_submitted',id);return this.latest(session.key);
    });
  }
  file(id){const row=this.s.one('SELECT * FROM portal_receipts WHERE id=?',String(id));if(!row)throw Error('Чек не найден.');return row;}
  review(id,action,reason,actor,portal) {
    if(!['approve','reject'].includes(action))throw Error('Неизвестное решение.');
    if(action==='reject'&&(typeof reason!=='string'||!reason.trim()||reason.length>1000))throw Error('Укажите причину отказа до 1000 символов.');
    return this.s.transaction(()=>{
      const row=this.file(id);if(row.status!=='review')throw Error('По этой заявке уже принято решение.');
      if(action==='approve'){
        const s=portal.find(row.owner);if(!s)throw Error('Демо-аккаунт не найден.');
        const p=JSON.parse(row.plan),now=Date.now(),end=s.subscription?.status==='ACTIVE'?new Date(s.subscription.expiresAt).getTime():0;
        s.subscription={status:'ACTIVE',planId:p.id,expiresAt:addCalendarMonths(Math.max(now,end||0),p.months).toISOString(),deviceLimit:p.deviceLimit,devicesUsed:s.subscription?.devicesUsed??0,devices:s.subscription?.devices??[],subscriptionUrl:'https://demo.invalid/colors/personal-subscription',syncedAt:new Date().toISOString()};
        portal.save(s);
      }
      this.s.run('UPDATE portal_receipts SET status=?,reviewed=?,reviewer=?,reason=? WHERE id=?',action==='approve'?'approved':'rejected',Date.now(),String(actor),action==='reject'?reason.trim():null,id);
      this.s.log(actor,action==='approve'?'demo_receipt_approved':'demo_receipt_rejected',id);
      return this.describe(this.file(id));
    });
  }
}
