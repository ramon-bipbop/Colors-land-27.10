export class Telegram {
  constructor(token, service) { this.token = token; this.v = service; this.running = true; this.flushing = false; }
  async api(method, body = {}) {
    let r;
    try { r = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(40000) }); }
    catch { throw Error('Telegram недоступен; повторите позже'); }
    const data = await r.json();
    if (!data.ok) { const error = Error(`Telegram ${method}: ${data.error_code ?? r.status}`); error.code = data.error_code; throw error; }
    return data.result;
  }
  send(id, text, buttons) {
    return this.api('sendMessage', { chat_id:id, text, link_preview_options:{is_disabled:true}, ...(buttons ? {reply_markup:{inline_keyboard:buttons}} : {}) });
  }
  menu(id) {
    const c = this.v.settings.value;
    return this.send(id, `${c.brand}\n\nПодписка, подключение и помощь — в одном месте.\nДоступ выдаётся после ручного одобрения заявки.`, [
      [{text:'Купить / продлить',callback_data:'buy'}],
      [{text:'Моя подписка',callback_data:'subscription'},{text:'Подключение',callback_data:'connect'}],
      [{text:'Помощь',callback_data:'support'}]
    ]);
  }
  async buy(id) {
    const v = this.v, error = v.settings.readiness();
    if (error) return this.send(id, 'Продажи ещё не открыты. Команда заполняет тарифы и условия. /support');
    const c = v.settings.value;
    return this.send(id, `Выберите тариф.\n\nУсловия: ${c.termsUrl}\nКонфиденциальность: ${c.privacyUrl}\nВозвраты: ${c.refundPolicy}\n\nОплата Stars, без автоматического списания. После оплаты заявка поступит администратору.`, c.plans.map(p => [{text:`${p.name} · ${p.stars} ⭐ · ${p.devices} устр.`,callback_data:`plan:${p.id}`}]) );
  }
  async invoice(id, plan) {
    const o = this.v.create(id, plan);
    if (o.state !== 'awaiting_payment') return this.send(id, `Заказ ${o.id} уже обрабатывается: ${o.state}. /subscription`);
    return this.api('sendInvoice', {chat_id:id, title:o.plan.name, description:`VPN на ${o.plan.days} дней, ${o.plan.devices} устройства. Доступ после ручного одобрения.`, payload:o.id, currency:'XTR', provider_token:'', prices:[{label:o.plan.name,amount:o.plan.stars}]});
  }
  async support(id) {
    const c = this.v.settings.value;
    return this.send(id, `Помощь с подключением и платежами.\n${c.supportUrl ?? 'Контакт поддержки ещё не заполнен.'}\nДля вопроса об оплате укажите номер заказа. Не отправляйте приватные ключи и персональную ссылку подписки.`);
  }
  async subscription(id) {
    const {subscription:s, orders} = this.v.snapshot(id);
    return this.send(id, s ? `Статус: ${s.status}\nОплачено до: ${new Date(s.expires).toISOString()}\n${s.status === 'active' && s.expires > this.v.clock() ? `Персональная ссылка: ${s.url}` : 'Для продления: /buy'}` : `Активной подписки пока нет.\n${orders[0] ? `Последний заказ: ${orders[0].id}\nСтатус: ${orders[0].state}` : 'Выберите тариф: /buy'}`);
  }
  async connect(id, os) {
    const c = this.v.settings.value;
    if (os && Object.hasOwn(c.instructions, os)) return this.send(id, c.instructions[os] || 'Инструкция ещё не заполнена. /support');
    return this.send(id, 'Выберите устройство. Персональная ссылка доступна в /subscription после выдачи доступа.', Object.keys(c.instructions).map(os => [{text:os,callback_data:`os:${os}`}]) );
  }
  async handle(update) {
    const v = this.v;
    if (update.pre_checkout_query) {
      const q = update.pre_checkout_query;
      try { v.checkout(q.invoice_payload, q.from.id, q.currency, q.total_amount); await this.api('answerPreCheckoutQuery',{pre_checkout_query_id:q.id,ok:true}); }
      catch { await this.api('answerPreCheckoutQuery',{pre_checkout_query_id:q.id,ok:false,error_message:'Счёт истёк или недействителен. Откройте /buy.'}); }
      return;
    }
    const m = update.message, q = update.callback_query;
    // No configuration links or subscription URLs in groups.
    if ((m?.chat.type ?? q?.message?.chat.type) !== 'private') return;
    const person = m?.from ?? q?.from; if (!person) return;
    const id = v.user(person.id, person.first_name ?? person.username ?? 'Пользователь');
    if (m?.successful_payment) {
      const p = m.successful_payment;
      v.paid(p.invoice_payload,id,p.currency,p.total_amount,p.telegram_payment_charge_id); return;
    }
    if (q) {
      await this.api('answerCallbackQuery',{callback_query_id:q.id});
      const [action, arg] = (q.data ?? '').split(':');
      if (action === 'buy') return this.buy(id);
      if (action === 'plan') return this.invoice(id,arg);
      if (action === 'subscription') return this.subscription(id);
      if (action === 'connect' || action === 'os') return this.connect(id,arg);
      if (action === 'support') return this.support(id);
      if (action === 'approve') { v.approve(arg,id); return this.send(id,`Заявка одобрена. Подготовьте доступ в панели, затем /issue ${arg} https://ссылка`); }
      return;
    }
    const [raw, ...args] = (m?.text ?? '').trim().split(/\s+/), cmd = raw?.split('@')[0];
    if (cmd === '/buy') return this.buy(id);
    if (cmd === '/subscription') return this.subscription(id);
    if (cmd === '/connect') return this.connect(id,args[0]);
    if (['/support','/paysupport'].includes(cmd)) return this.support(id);
    if (cmd === '/terms') return this.send(id, v.settings.value.termsUrl ?? 'Условия ещё не заполнены.');
    if (['/admin','/order','/approve','/issue','/reject','/disabled','/refund'].includes(cmd)) {
      v.admin(id);
      if (cmd === '/admin') return this.send(id, 'Команды:\n/order ID — оплата и срок\n/approve ID — одобрить\n/issue ID https://ссылка — подтвердить выдачу в панели\n/reject ID причина — отказ и возврат\n/refund ID — вернуть Stars\n/disabled USER_ID — подтвердить отключение в панели\n\nОчередь:\n' + v.dashboard().orders.filter(o => ['review','approved','refund_required'].includes(o.state)).slice(0,15).map(o=>`${o.id}: ${o.state}`).join('\n'));
      if (cmd === '/order') { const o = v.order(args[0]); return this.send(id, `${o.id}\nКлиент: ${o.user_id}\nСостояние: ${o.state}\nТариф: ${o.plan.name}, ${o.plan.days} дней, ${o.plan.devices} устр.\nУстановите в панели срок до: ${new Date(o.expires ?? v.targetExpiry(o)).toISOString()}\nСсылка не создаётся ботом автоматически.`); }
      if (cmd === '/approve') v.approve(args[0],id);
      if (cmd === '/issue') v.issue(args[0],id,args[1]);
      if (cmd === '/reject') v.reject(args[0],id,args.slice(1).join(' '));
      if (cmd === '/disabled') v.disabled(args[0],id);
      if (cmd === '/refund') {
        const o = v.order(args[0]);
        if (o.state !== 'refunded') {
          if (o.state !== 'refund_required') throw Error('Сначала отклоните заявку с причиной');
          try { await this.api('refundStarPayment',{user_id:Number(o.user_id),telegram_payment_charge_id:o.charge}); }
          catch (e) { throw Error('Возврат не подтверждён Telegram. Проверьте платёж и повторите /refund. При уже выполненном возврате нужна ручная сверка.'); }
          v.refunded(o.id,id);
        }
      }
      return this.send(id,'Действие сохранено. /admin');
    }
    return this.menu(id);
  }
  async flush() {
    if (this.flushing) return; this.flushing = true;
    try {
      for (const e of this.v.s.all('SELECT * FROM outbox WHERE sent IS NULL AND next_at<=? ORDER BY id LIMIT 20',Date.now())) {
        try {
          const orderId = e.event_key.startsWith('review:') ? e.event_key.split(':')[1] : null;
          await this.send(e.recipient,e.text,orderId ? [[{text:'Одобрить заявку',callback_data:`approve:${orderId}`}]] : undefined);
          this.v.s.run('UPDATE outbox SET sent=? WHERE id=?',Date.now(),e.id);
        }
        catch { this.v.s.run('UPDATE outbox SET attempts=attempts+1,next_at=? WHERE id=?',Date.now()+Math.min(3600000,5000*2**Math.min(e.attempts,10)),e.id); }
      }
    } finally { this.flushing = false; }
  }
  async poll() {
    const me = await this.api('getMe');
    console.log(`Telegram подключён: @${me.username}`);
    const webhook = await this.api('getWebhookInfo');
    if (webhook.url) throw Error('У бота уже установлен webhook. Отключите его перед запуском polling.');
    while (this.running) {
      try {
        const updates = await this.api('getUpdates',{offset:Number(this.v.s.meta('offset') ?? 0),timeout:25,allowed_updates:['message','callback_query','pre_checkout_query']});
        for (const u of updates) {
          try { await this.handle(u); }
          catch (e) {
            // Preserve unexpected paid transactions for reconciliation without blocking all users.
            if (u.message?.successful_payment) {
              const p = u.message.successful_payment;
              this.v.s.transaction(()=>{
                this.v.s.run('INSERT OR IGNORE INTO payment_incidents VALUES(?,?,?,?,?,?,?)',u.update_id,p.invoice_payload,String(u.message.from.id),p.currency,p.total_amount,p.telegram_payment_charge_id,Date.now());
                this.v.notifyAdmins(`payment_incident:${u.update_id}`,`Оплаченную транзакцию не удалось сопоставить с заказом. Событие ${u.update_id} сохранено в payment_incidents. Проверьте оплату и выдачу вручную; не просите клиента платить повторно.`);
              });
              this.v.s.setMeta('offset',u.update_id+1);
              continue;
            }
            const id = u.message?.chat.type === 'private' ? u.message.chat.id : u.callback_query?.message?.chat.type === 'private' ? u.callback_query.from.id : null;
            if (id) await this.send(id, e.message).catch(()=>{});
          }
          this.v.s.setMeta('offset',u.update_id+1);
        }
      } catch { console.error('Ошибка получения/обработки обновлений Telegram; повтор через 3 секунды.'); await new Promise(r=>setTimeout(r,3000)); }
    }
  }
}
