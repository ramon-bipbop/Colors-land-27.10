import { connectionContent as c } from './connection-content.js';
const escape = s => String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export function connectionCard({ canCopy = false, standalone = false } = {}) {
  return `<article class="connection-card ${standalone?'connection-standalone':''}" aria-label="Как подключить VPN через Incy">
    <div class="connection-top"><span class="connection-brand">${escape(c.brand)}</span><span class="connection-limit"><span aria-hidden="true">◉</span> ${escape(c.devices)}</span></div>
    <div class="connection-heading"><div class="connection-kicker">ИНСТРУКЦИЯ ПОДКЛЮЧЕНИЯ</div><h2>${escape(c.title).replace('\n','<br>')}</h2><p>Ваша ссылка подписки — всё, что нужно для начала.</p></div>
    ${canCopy?'<button class="btn connection-copy" data-action="copy">Скопировать мою ссылку <span aria-hidden="true">↗</span></button>':''}
    <ol class="connection-steps">${c.steps.map((s,i)=>`<li><span class="connection-number" aria-hidden="true">${String(i+1).padStart(2,'0')}</span><div><h3>${escape(s.title)}</h3><p>${escape(s.text)}</p></div></li>`).join('')}</ol>
    <aside class="connection-compensation"><span class="connection-gift" aria-hidden="true">✦</span><div><h3>${escape(c.compensation.title)}</h3><p>${escape(c.compensation.text)}</p></div></aside>
    <p class="connection-privacy">${escape(c.privacy)}</p>
  </article>`;
}
