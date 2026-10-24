import { randomUUID } from 'node:crypto';
import { validHttps } from './config.js';
export const DAY = 86400000;
export class Service {
  constructor(store, settings, admins = [], clock = () => Date.now()) { this.s = store; this.settings = settings; this.admins = admins.map(String); this.clock = clock; }
  user(id, name = 'Пользователь') {
    id = String(id); this.s.run('INSERT INTO users VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name', id, String(name).slice(0, 100)); return id;
  }
  admin(id) { if (!this.admins.includes(String(id))) throw Error('Нет прав администратора'); }
  order(id) { const o = this.s.one('SELECT * FROM orders WHERE id=?', id); if (!o) throw Error('Заказ не найден'); return { ...o, plan: JSON.parse(o.plan) }; }
  own(id, user) { const o = this.order(id); if (o.user_id !== String(user)) throw Error('Заказ принадлежит другому пользователю'); return o; }
  notifyAdmins(key, text) { for (const a of this.admins) this.s.event(`${key}:${a}`, a, text); }
  create(userId, planId) {
    const error = this.settings.readiness(); if (error) throw Error(`Продажи ещё не настроены: ${error}`);
    const plan = this.settings.value.plans.find(p => p.id === planId); if (!plan) throw Error('Тариф не найден');
    return this.s.transaction(() => {
      const pending = this.s.one("SELECT id FROM orders WHERE user_id=? AND state IN ('awaiting_payment','review','approved')", String(userId));
      if (pending) return this.order(pending.id);
      const id = randomUUID(), now = this.clock();
      this.s.run('INSERT INTO orders(id,user_id,plan,state,created,deadline) VALUES(?,?,?,?,?,?)', id, String(userId), JSON.stringify(plan), 'awaiting_payment', now, now + this.settings.value.orderTtlMinutes * 60000);
      this.s.log(userId, 'order_created', id, now); return this.order(id);
    });
  }
  checkout(id, userId, currency, amount) {
    const o = this.own(id, userId);
    if (o.state !== 'awaiting_payment' || o.deadline <= this.clock() || currency !== 'XTR' || amount !== o.plan.stars) throw Error('Счёт недействителен. Откройте новый заказ в боте.');
    return o;
  }
  paid(id, userId, currency, amount, charge) {
    return this.s.transaction(() => {
      const o = this.own(id, userId);
      if (currency !== 'XTR' || amount !== o.plan.stars || typeof charge !== 'string' || !charge) throw Error('Платёж не соответствует заказу');
      if (o.charge === charge) return o;
      if (o.charge || this.s.one('SELECT id FROM orders WHERE charge=?', charge)) throw Error('Повторный или чужой платёж');
      // Telegram may deliver successful_payment after the local deadline; money must not be lost.
      if (!['awaiting_payment','expired'].includes(o.state)) throw Error('Неверное состояние заказа');
      this.s.run("UPDATE orders SET state='review', charge=?, review_at=? WHERE id=?", charge, this.clock(), id);
      this.s.log('telegram', 'payment_confirmed', id, this.clock());
      this.s.event(`paid:${id}`, userId, `Оплата заказа ${id} получена. Администратор проверит заявку и выдаст доступ. Повторно платить не нужно.`);
      this.notifyAdmins(`review:${id}`, `Оплата получена: ${id}\nПользователь: ${userId}\n${o.plan.name}, ${o.plan.stars} Stars\nПодтвердить: /approve ${id}\nОтклонить с причиной: /reject ${id} причина`);
      return this.order(id);
    });
  }
  approve(id, actor) {
    this.admin(actor); return this.s.transaction(() => {
      const o = this.order(id); if (['approved','active'].includes(o.state)) return o;
      if (o.state !== 'review' || !o.charge) throw Error('Нет подтверждённой оплаты для одобрения');
      this.s.run("UPDATE orders SET state='approved',approved_by=? WHERE id=?", String(actor), id);
      this.s.log(actor, 'approved', id, this.clock());
      this.notifyAdmins(`provision:${id}`, `Заказ ${id} одобрен. Создайте или продлите персональный доступ в VPN-панели.\nПараметры и срок: /order ${id}\nПосле изменения панели: /issue ${id} https://персональная-ссылка`);
      return this.order(id);
    });
  }
  targetExpiry(o) { const sub = this.s.one('SELECT * FROM subscriptions WHERE user_id=?', o.user_id); return Math.max(this.clock(), sub?.expires ?? 0) + o.plan.days * DAY; }
  issue(id, actor, url) {
    this.admin(actor); if (!validHttps(url) || url.length > 2048) throw Error('Нужна персональная HTTPS-ссылка подписки');
    return this.s.transaction(() => {
      const o = this.order(id); if (o.state === 'active') return o;
      if (o.state !== 'approved') throw Error('Сначала одобрите оплаченную заявку');
      const expires = this.targetExpiry(o);
      this.s.run(`INSERT INTO subscriptions VALUES(?,?,?,'active',?) ON CONFLICT(user_id) DO UPDATE SET
        url=excluded.url, expires=excluded.expires, status='active', order_id=excluded.order_id`, o.user_id, url, expires, id);
      this.s.run("UPDATE orders SET state='active',expires=? WHERE id=?", expires, id);
      this.s.log(actor, 'access_issued', id, this.clock());
      this.s.event(`issued:${id}`, o.user_id, `Доступ активирован до ${new Date(expires).toISOString()}.\nПерсональная ссылка: ${url}\nНе передавайте её другим. Инструкции: /connect`);
      return this.order(id);
    });
  }
  reject(id, actor, reason) {
    this.admin(actor); if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) throw Error('Укажите причину до 500 символов');
    return this.s.transaction(() => {
      const o = this.order(id); if (o.state === 'refund_required') return o;
      if (!['review','approved'].includes(o.state)) throw Error('Эту заявку нельзя отклонить');
      this.s.run("UPDATE orders SET state='refund_required',rejection=? WHERE id=?", reason, id);
      this.s.log(actor, 'rejected_refund_required', id, this.clock());
      this.s.event(`rejected:${id}`, o.user_id, `Заявка ${id} отклонена: ${reason}. Оплата получена; команда должна выполнить возврат. /paysupport`);
      this.notifyAdmins(`refund:${id}`, `Нужен возврат Stars для заказа ${id}. Команда: /refund ${id}`); return this.order(id);
    });
  }
  refunded(id, actor) {
    this.admin(actor); return this.s.transaction(() => {
      const o = this.order(id); if (o.state === 'refunded') return o;
      if (o.state !== 'refund_required') throw Error('Заказ не ожидает возврата');
      this.s.run("UPDATE orders SET state='refunded' WHERE id=?", id); this.s.log(actor, 'refunded', id, this.clock());
      this.s.event(`refunded:${id}`, o.user_id, `Stars за заказ ${id} возвращены.`); return this.order(id);
    });
  }
  disabled(userId, actor) {
    this.admin(actor); return this.s.transaction(() => {
      const sub = this.s.one('SELECT * FROM subscriptions WHERE user_id=?', String(userId));
      if (!sub || sub.status !== 'disable_required' || sub.expires > this.clock()) throw Error('Нет просроченного доступа для отключения');
      this.s.run("UPDATE subscriptions SET status='disabled' WHERE user_id=?", String(userId));
      this.s.log(actor, 'disabled_in_panel_confirmed', String(userId), this.clock());
      this.s.event(`disabled:${sub.order_id}`, userId, 'Администратор подтвердил отключение доступа. Для нового подключения: /buy');
    });
  }
  tick() {
    const now = this.clock(), c = this.settings.value;
    this.s.transaction(() => {
      for (const o of this.s.all("SELECT * FROM orders WHERE state='awaiting_payment' AND deadline<=?", now)) {
        this.s.run("UPDATE orders SET state='expired' WHERE id=?", o.id);
        this.s.event(`order_expired:${o.id}`, o.user_id, `Срок оплаты заказа ${o.id} закончился. Действующая подписка от этого не меняется. Новый заказ: /buy`);
        this.notifyAdmins(`order_expired:${o.id}`, `Заказ ${o.id} не оплачен в срок. Действующий VPN пользователя не отключайте по этому событию.`);
      }
      if (c.reviewReminderHours) for (const o of this.s.all("SELECT * FROM orders WHERE state IN ('review','approved') AND review_at<=?", now - c.reviewReminderHours * 3600000)) {
        const period = Math.floor((now - o.review_at) / (c.reviewReminderHours * 3600000));
        this.notifyAdmins(`review_late:${o.id}:${period}`, `Заявка ${o.id} ожидает ручной обработки: ${o.state}`);
      }
      for (const sub of this.s.all("SELECT * FROM subscriptions WHERE status!='disabled'")) {
        const remaining = sub.expires - now;
        const relevant = [...(c.reminderHours ?? [])].sort((a,b)=>a-b).find(h => remaining <= h * 3600000 && (remaining > 0 || h === 0));
        if (relevant !== undefined) { const h = relevant;
          this.s.event(`reminder:${sub.order_id}:${h}`, sub.user_id, remaining > 0 ? `Подписка заканчивается ${new Date(sub.expires).toISOString()}. Продление: /buy` : 'Срок подписки закончился. Для продления: /buy. Отключение обрабатывает администратор.');
        }
        if (remaining <= 0 && sub.status === 'active') {
          this.s.run("UPDATE subscriptions SET status='disable_required' WHERE user_id=?", sub.user_id);
          this.notifyAdmins(`disable:${sub.order_id}`, `Истёк доступ пользователя ${sub.user_id}. Отключите его в VPN-панели, затем подтвердите: /disabled ${sub.user_id}`);
        }
      }
    });
  }
  snapshot(userId) {
    return { subscription: this.s.one('SELECT * FROM subscriptions WHERE user_id=?', String(userId)) ?? null,
      orders: this.s.all('SELECT * FROM orders WHERE user_id=? ORDER BY created DESC', String(userId)).map(o => ({ ...o, plan: JSON.parse(o.plan), charge: o.charge ? 'confirmed' : null })) };
  }
  dashboard() {
    return { orders: this.s.all('SELECT o.*,u.name FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.created DESC LIMIT 200').map(o => ({ ...o, plan: JSON.parse(o.plan), charge: o.charge ? 'confirmed' : null })),
      subscriptions: this.s.all('SELECT * FROM subscriptions ORDER BY expires LIMIT 200'),
      audit: this.s.all('SELECT * FROM audit ORDER BY id DESC LIMIT 60'),
      notifications: this.s.all('SELECT id,recipient,text,sent,attempts FROM outbox ORDER BY id DESC LIMIT 60') };
  }
}
