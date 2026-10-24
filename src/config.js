import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function validate(c, { ready = false } = {}) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw Error('Настройки должны быть объектом');
  if (typeof c.brand !== 'string' || !c.brand.trim() || c.brand.length > 80) throw Error('Укажите название до 80 символов');
  for (const k of ['supportUrl', 'termsUrl', 'privacyUrl']) {
    if (c[k] != null && (typeof c[k] !== 'string' || !validHttps(c[k]))) throw Error(`${k}: нужна HTTPS-ссылка`);
  }
  for (const k of ['orderTtlMinutes', 'reviewReminderHours', 'trialDays']) {
    if (c[k] != null && (!Number.isSafeInteger(c[k]) || c[k] <= 0 || c[k] > 525600)) throw Error(`${k}: нужно положительное целое число`);
  }
  if (c.trialDays != null) throw Error('Пробный период пока не реализован: оставьте trialDays=null');
  if (c.manualApproval != null && c.manualApproval !== true) throw Error('В этом MVP выдача требует ручного одобрения');
  if (c.provisioning != null && c.provisioning !== 'manual') throw Error('В MVP поддерживается manual; адаптер панели подключается отдельно');
  if (c.refundPolicy != null && (typeof c.refundPolicy !== 'string' || c.refundPolicy.length > 2500)) throw Error('refundPolicy: текст до 2500 символов');
  if (c.reminderHours != null && (!Array.isArray(c.reminderHours) || c.reminderHours.length > 20 || c.reminderHours.some(h => !Number.isSafeInteger(h) || h < 0 || h > 8760))) throw Error('reminderHours: массив часов >= 0');
  if (!Array.isArray(c.plans) || c.plans.length > 15) throw Error('plans: массив до 15 тарифов');
  const ids = new Set();
  for (const p of c.plans) {
    if (!/^[a-z0-9-]{1,24}$/.test(p.id) || ids.has(p.id)) throw Error('У тарифов должны быть уникальные id: a-z, 0-9, дефис');
    ids.add(p.id);
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60) throw Error('Укажите название тарифа до 60 символов');
    for (const k of ['days', 'stars', 'devices']) if (!Number.isSafeInteger(p[k]) || p[k] <= 0) throw Error(`Тариф ${p.id}: заполните ${k}`);
    if (p.days > 3650 || p.stars > 100000 || p.devices > 100) throw Error('Слишком большое значение тарифа');
  }
  if (!c.instructions || ['iOS','Android','Windows','macOS'].some(os => typeof c.instructions[os] !== 'string' || c.instructions[os].length > 2500)) throw Error('Заполните объект instructions для четырёх ОС');
  if (ready) {
    for (const k of ['supportUrl','termsUrl','privacyUrl','refundPolicy','orderTtlMinutes','reminderHours','reviewReminderHours','manualApproval','provisioning']) if (c[k] == null || c[k] === '') throw Error(`Перед продажей заполните ${k}`);
    if (!c.plans.length) throw Error('Добавьте хотя бы один тариф');
    if (Object.values(c.instructions).some(s => !s.trim())) throw Error('Заполните инструкции для всех устройств');
  }
  return c;
}
export function validHttps(s) { try { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } }
export class Settings {
  constructor(path) { this.path = path; this.value = validate(JSON.parse(readFileSync(path, 'utf8'))); }
  save(value) {
    validate(value); mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path + '.tmp', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    renameSync(this.path + '.tmp', this.path); this.value = value;
  }
  readiness() { try { validate(this.value, { ready: true }); return null; } catch (e) { return e.message; } }
}
