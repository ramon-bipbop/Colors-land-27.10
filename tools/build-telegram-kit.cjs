// Asset export only. Does not change the website or contact external services.
// Requires sharp as a development tool; the website itself stays dependency-free.
const sharp = require('sharp');
const {readFileSync,writeFileSync,mkdirSync} = require('node:fs');
const {resolve,join} = require('node:path');
const {pathToFileURL} = require('node:url');
const root=resolve(__dirname,'..');
const output=join(root,'brand','telegram');
const source=join(output,'svg');
mkdirSync(source,{recursive:true});
const logo=readFileSync(join(root,'public','logo.svg'),'utf8');
const mark=logo.replace(/<svg[^>]*>/,'').replace('</svg>','');
const C={bg:'#101316',panel:'#191e22',line:'#30383d',white:'#f3f5f4',muted:'#a1aaa9',green:'#c4f46c'};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const text=(s,x,y,size=28,fill=C.white,weight=400,extra='')=>`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" ${extra}>${esc(s)}</text>`;
const rect=(x,y,w,h,fill=C.panel,stroke=C.line,r=20)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}"/>`;
const logoAt=(cx,cy,height)=>`<g transform="translate(${cx-height/420*168},${cy-height/2}) scale(${height/420})">${mark}</g>`;
const eyebrow=(s,x,y)=>`<circle cx="${x+4}" cy="${y-6}" r="4" fill="${C.green}"/>${text(s,x+23,y,17,C.green,400,'font-family="Consolas,monospace" letter-spacing="2.5"')}`;
const header=(w,pad=96)=>`${logoAt(pad+22,93,50)}${text('Colors',pad+62,105,35,C.white,600,'letter-spacing="-1"')}${text('VPN',pad+175,104,23,C.muted,400,'letter-spacing="1"')}<path d="M${pad} 158H${w-pad}" stroke="${C.line}"/>`;
const footer=(w,h,label='ИНТЕРНЕТ В ВАШИХ ЦВЕТАХ',pad=96)=>`<path d="M${pad} ${h-105}H${w-pad}" stroke="${C.line}"/>${text(label,pad,h-57,16,C.muted,400,'font-family="Consolas,monospace" letter-spacing="2"')}${text('COLORS VPN',w-pad,h-57,16,C.green,400,'text-anchor="end" font-family="Consolas,monospace" letter-spacing="2"')}`;
function bg(w,h){return `<rect width="${w}" height="${h}" fill="${C.bg}"/><ellipse cx="${w*.84}" cy="${h*.45}" rx="${w*.36}" ry="${h*.5}" fill="url(#halo)"/>`;}
function art(cx,cy,size=400){return `<g transform="translate(${cx},${cy})"><ellipse rx="${size*.63}" ry="${size*.39}" fill="none" stroke="#455b36" stroke-opacity=".36" transform="rotate(-30)"/><ellipse rx="${size*.48}" ry="${size*.66}" fill="none" stroke="#455b36" stroke-opacity=".32" transform="rotate(34)"/><g transform="rotate(8)">${rect(-size*.39,-size*.43,size*.78,size*.86,'url(#plate)','#3c4e34',size*.12)}</g>${logoAt(0,0,size*.59)}${text('+',size*.55,-size*.44,36,'#526445',300)}${text('+',-size*.64,size*.44,36,'#526445',300)}</g>`;}
function svg(w,h,body){return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Colors VPN"><defs><radialGradient id="halo"><stop stop-color="#648d31" stop-opacity=".16"/><stop offset="1" stop-color="#101316" stop-opacity="0"/></radialGradient><linearGradient id="plate" x2="1" y2="1"><stop stop-color="#263724"/><stop offset="1" stop-color="#141c18"/></linearGradient></defs><g font-family="Segoe UI,Arial,sans-serif">${body}</g></svg>`;}
async function save(name,w,h,body){const xml=svg(w,h,body);writeFileSync(join(source,name+'.svg'),xml);await sharp(Buffer.from(xml)).png().toFile(join(output,name+'.png'));return name;}

(async()=>{
 const {plans,money}=await import(pathToFileURL(join(root,'public','portal-model.js')));
 await save('01-avatar-1080',1080,1080,bg(1080,1080)+logoAt(540,540,680));
 await sharp(join(output,'01-avatar-1080.png')).resize(512,512).png().toFile(join(output,'02-avatar-512.png'));
 await save('03-logo-transparent',1080,1260,logoAt(540,630,1190));
 writeFileSync(join(source,'logo-original.svg'),logo);

 await save('04-welcome',1600,1000,bg(1600,1000)+header(1600)+eyebrow('ВАШЕ ПОДКЛЮЧЕНИЕ',96,238)+text('Больше свободы.',96,365,84,C.white,500,'letter-spacing="-3.5"')+text('Меньше границ.',96,467,84,C.green,500,'letter-spacing="-3.5"')+text('Интернет в ваших цветах.',96,555,30,C.muted)+art(1243,463,440)+rect(96,688,1408,135,'#151a1d')+text('01',128,735,17,C.green,400,'font-family="Consolas,monospace"')+text('Подключение',128,783,29)+text('02',600,735,17,C.green,400,'font-family="Consolas,monospace"')+text('Тарифы',600,783,29)+text('03',1074,735,17,C.green,400,'font-family="Consolas,monospace"')+text('Помощь',1074,783,29)+'<path d="M563 721V792M1035 721V792" stroke="#30383d"/>'+footer(1600,1000));

 let cards='';
 for(let i=0;i<plans.length;i++){
  const p=plans[i],x=96+i*357,featured=i===1;
  cards+=rect(x,425,337,570,featured?'#222d1c':C.panel,featured?'#819f55':C.line,22);
  if(featured)cards+=rect(x+28,408,222,34,C.green,C.green,7)+text('УДОБНО НАЧАТЬ',x+44,431,13,'#182211',600,'letter-spacing="1.5"');
  cards+=text(p.title,x+29,497,32)+text(money(p.price),x+29,603,62,C.white,500,'letter-spacing="-2"')+text('≈ '+money(Math.round(p.price/p.months))+' / месяц',x+29,651,22,C.muted)+`<path d="M${x+29} 694H${x+308}" stroke="${C.line}"/>`;
  ['3 устройства','Подключение в Incy','Без автосписаний'].forEach((s,j)=>{cards+=text('✓',x+29,750+j*51,23,C.green)+text(s,x+61,750+j*51,22,C.muted);});
  cards+=rect(x+29,922,279,43,featured?C.green:'#242c2e',featured?C.green:'#424c49',7)+text('COLORS VPN',x+48,950,15,featured?'#182211':C.white,500,'letter-spacing="1.8"')+text('↗',x+282,952,23,featured?'#182211':C.green);
 }
 await save('05-tariffs',1600,1200,bg(1600,1200)+header(1600)+eyebrow('ПОДПИСКА / ТАРИФЫ',96,226)+text('Выберите свой срок.',96,315,66,C.white,500,'letter-spacing="-2.5"')+text('Одна подписка — три ваших устройства.',96,370,29,C.muted)+cards+text('Стоимость указана за весь период подписки.',96,1056,24,C.muted)+footer(1600,1200,'ПОНЯТНЫЕ УСЛОВИЯ. ВАШ ВЫБОР.'));

 const steps=[['Скопируйте персональную ссылку','Из сообщения с доступом или личного кабинета.'],['Отправьте её на нужное устройство','Скопируйте её уже на том устройстве, которое подключаете.'],['Скачайте и откройте Incy','Ссылки для вашей платформы — в тексте поста.'],['Нажмите «+» справа вверху','В открытом приложении Incy.'],['Выберите «Вставить из буфера обмена»','Добавьте подписку и включите подключение.']];
 let rows='';steps.forEach(([title,desc],i)=>{const y=385+i*122;rows+=`<circle cx="130" cy="${y+15}" r="31" fill="#232e1c" stroke="#526b37"/>`+text(String(i+1).padStart(2,'0'),130,y+22,19,C.green,400,'text-anchor="middle" font-family="Consolas,monospace"')+text(title,196,y+9,32,C.white,500)+text(desc,196,y+50,24,C.muted);if(i<4)rows+=`<path d="M196 ${y+82}H1504" stroke="#283034"/>`;});
 await save('06-connection',1600,1200,bg(1600,1200)+header(1600)+eyebrow('НАСТРОЙКА / INCY',96,226)+text('Как подключить Colors VPN',96,315,64,C.white,500,'letter-spacing="-2.5"')+rows+rect(96,1042,1408,56,'#222d1c','#3c512b',10)+text('Доступ на 3 устройства · App Store / Google Play / другие устройства',122,1078,23,C.green)+footer(1600,1200));

 let mobileCards='';
 plans.forEach((p,i)=>{const x=64+(i%2)*486,y=440+Math.floor(i/2)*345,featured=i===1;
  mobileCards+=rect(x,y,466,320,featured?'#222d1c':C.panel,featured?'#819f55':C.line,20)+text(p.title,x+30,y+61,36,C.white,500)+text(money(p.price),x+30,y+163,82,C.white,500,'letter-spacing="-3"')+text('≈ '+money(Math.round(p.price/p.months))+' / месяц',x+30,y+216,29,C.muted)+`<path d="M${x+30} ${y+246}H${x+436}" stroke="#3a443c"/>`+text('3 устройства',x+30,y+286,29,C.green);
 });
 await save('05-tariffs-mobile',1080,1350,bg(1080,1350)+header(1080,64)+eyebrow('ПОДПИСКА / ТАРИФЫ',64,237)+text('Выберите',64,319,67,C.white,500,'letter-spacing="-2"')+text('свой срок.',64,394,67,C.green,500,'letter-spacing="-2"')+mobileCards+text('Цена за весь период. Без автосписаний.',64,1192,29,C.muted)+footer(1080,1350,'ТРИ ВАШИХ УСТРОЙСТВА',64));
 const mobileSteps=[['Скопируйте ссылку','Из сообщения с доступом.'],['Отправьте на нужное устройство','Скопируйте ссылку уже на нём.'],['Скачайте и откройте Incy','Ссылки на скачивание — под постом.'],['Нажмите «+» справа вверху','В открытом приложении.'],['«Вставить из буфера обмена»','Добавьте подписку и подключитесь.']];
 let mobileRows='';mobileSteps.forEach(([title,desc],i)=>{const y=445+i*142;mobileRows+=`<circle cx="93" cy="${y+13}" r="29" fill="#232e1c" stroke="#526b37"/>`+text(i+1,93,y+21,24,C.green,400,'text-anchor="middle" font-family="Consolas,monospace"')+text(title,153,y+8,36,C.white,500)+text(desc,153,y+53,28,C.muted);if(i<4)mobileRows+=`<path d="M153 ${y+89}H1016" stroke="#30383d"/>`;});
 await save('06-connection-mobile',1080,1350,bg(1080,1350)+header(1080,64)+eyebrow('НАСТРОЙКА / INCY',64,237)+text('Как подключить',64,319,67,C.white,500,'letter-spacing="-2"')+text('Colors VPN',64,394,67,C.green,500,'letter-spacing="-2"')+mobileRows+rect(64,1177,952,63,'#222d1c','#3c512b',10)+text('Одна подписка — три ваших устройства.',91,1218,30,C.green)+footer(1080,1350,'ПОДКЛЮЧЕНИЕ В ПЯТЬ ШАГОВ',64));

 await save('07-updates',1600,1000,bg(1600,1000)+header(1600)+eyebrow('НОВОСТИ СЕРВИСА',96,238)+text('Всё важное.',96,365,88,C.white,500,'letter-spacing="-3.5"')+text('В одном месте.',96,469,88,C.green,500,'letter-spacing="-3.5"')+text('Обновления Colors VPN',96,560,30,C.muted)+text('и помощь с подключением.',96,608,30,C.muted)+art(1243,460,420)+rect(96,730,365,59,'#222d1c','#435a2f',29)+text('НА ВАШЕЙ СТОРОНЕ',126,768,18,C.green,400,'letter-spacing="2"')+footer(1600,1000));
 await save('08-post-template',1600,1000,bg(1600,1000)+header(1600)+`<g opacity=".2">${art(1320,470,480)}</g>`+footer(1600,1000,'НА ВАШЕЙ СТОРОНЕ'));
 await save('09-story',1080,1920,bg(1080,1920)+header(1080,80)+eyebrow('ВАШЕ ПОДКЛЮЧЕНИЕ',80,316)+text('Больше',80,436,92,C.white,500,'letter-spacing="-3"')+text('свободы.',80,542,92,C.white,500,'letter-spacing="-3"')+text('Меньше границ.',80,661,82,C.green,500,'letter-spacing="-3"')+art(540,1090,620)+rect(80,1510,920,154,'#191e22')+text('3 устройства.',120,1576,37,C.white,500)+text('Одна подписка Colors VPN.',120,1624,29,C.muted)+text('Интернет в ваших цветах.',80,1756,32,C.muted)+footer(1080,1920,'COLORS VPN / НА СВЯЗИ',80));

 // Contact sheet: avatar in its real circular crop, then the reusable post artwork.
 const tiles=[['01-avatar-1080','АВАТАР / КРУГЛАЯ ОБРЕЗКА'],['04-welcome','ПРИВЕТСТВИЕ / ЗАКРЕП'],['05-tariffs-mobile','ТАРИФЫ / ВЕРТИКАЛЬНАЯ КАРТОЧКА'],['06-connection-mobile','ПОДКЛЮЧЕНИЕ / ВЕРТИКАЛЬНАЯ КАРТОЧКА'],['07-updates','НОВОСТИ СЕРВИСА'],['08-post-template','ШАБЛОН ДЛЯ ПОСТОВ']];
 const composites=[];
 for(let i=0;i<tiles.length;i++){
  const [name,label]=tiles[i],left=60+(i%2)*780,top=160+Math.floor(i/2)*580;
  let thumb;
  if(i===0){thumb=await sharp(join(output,name+'.png')).resize(420,420).composite([{input:Buffer.from('<svg width="420" height="420"><circle cx="210" cy="210" r="210" fill="white"/></svg>'),blend:'dest-in'}]).png().toBuffer();composites.push({input:thumb,left:left+150,top});}
  else{thumb=await sharp(join(output,name+'.png')).resize(720,450,{fit:'contain',background:C.bg}).png().toBuffer();composites.push({input:thumb,left,top});}
  composites.push({input:Buffer.from(svg(720,60,text(label,0,40,19,C.muted,400,'font-family="Consolas,monospace" letter-spacing="1.5"'))),left,top:top+466});
 }
 const contact=svg(1620,1920,`<rect width="1620" height="1920" fill="#0b0e10"/>`+text('Colors VPN',60,78,45,C.white,600,'letter-spacing="-1.5"')+text('TELEGRAM / ВИЗУАЛЬНЫЙ КОМПЛЕКТ',60,118,19,C.green,400,'font-family="Consolas,monospace" letter-spacing="3"'));
 await sharp(Buffer.from(contact)).composite(composites).jpeg({quality:92}).toFile(join(output,'00-preview.jpg'));
 console.log('Exported avatar, transparent mark, 5 post designs, story and contact sheet to brand/telegram');
})().catch(err=>{console.error(err);process.exit(1);});
