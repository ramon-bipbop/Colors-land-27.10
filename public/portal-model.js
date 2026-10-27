export const plans = [
  {id:'m1',months:1,title:'1 месяц',price:250},
  {id:'m3',months:3,title:'3 месяца',price:550},
  {id:'m6',months:6,title:'6 месяцев',price:990},
  {id:'m12',months:12,title:'12 месяцев',price:1850}
];
export const defaultDeviceLimit = 3;
export const deviceRecommendation = 'Для корректного подключения рекомендуем использовать одну подписку на устройствах разных типов: 1 телефон, 1 компьютер и 1 телевизор.';
export function deviceType(device={}) {
  if(['phone','computer','tv','tablet'].includes(device.type))return device.type;
  const value=[device.name,device.platform,device.osVersion].filter(Boolean).join(' ').toLowerCase();
  if(/android[ _-]?tv|apple[ _-]?tv|tvos|телевизор|smart[ _-]?tv|\btv\b|bravia|mi box|chromecast|fire[ _-]?tv/.test(value))return 'tv';
  if(/ipad|tablet|планшет|galaxy[ _-]?tab/.test(value))return 'tablet';
  if(/iphone|\bios\b|телефон|smartphone|\bphone\b|pixel|galaxy[ _-]?[saz]\d/.test(value))return 'phone';
  // Android alone also describes TVs/tablets: leave ambiguous models unclassified.
  if(/android/.test(value))return null;
  if(/windows|macbook|macos|imac|darwin|linux|ubuntu|компьютер|ноутбук|\bpc\b/.test(value))return 'computer';
  return null;
}
export function duplicateDeviceTypes(devices=[]) {
  const counts=new Map();
  for(const d of devices){const type=deviceType(d);if(type)counts.set(type,(counts.get(type)??0)+1);}
  const labels={phone:'Телефоны',computer:'Компьютеры',tv:'Телевизоры',tablet:'Планшеты'};
  return [...counts].filter(([,count])=>count>1).map(([type,count])=>({type,count,label:labels[type]}));
}
export const downloads = [
  {name:'App Store',os:'iPhone · iPad',url:'https://apps.apple.com/us/app/incy/id6756943388'},
  {name:'Google Play',os:'Android',url:'https://play.google.com/store/apps/details?id=llc.itdev.incy&hl=ru'},
  {name:'Другие устройства',os:'Windows · macOS · другие',url:'https://incy.cc/#downloads'}
];
export const money = n => new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n)+' ₽';
const parts = date => { const p = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(date)); return Object.fromEntries(p.filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)])); };
const dayNumber = p => Date.UTC(p.year,p.month-1,p.day)/86400000;
export function addCalendarMonths(date,months) {
  // Moscow has UTC+03:00; retain the local time and clamp month-end dates.
  const offset=3*3600000,d=new Date(new Date(date).getTime()+offset),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);
  const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return new Date(d.getTime()-offset);
}
function addPartsMonths(p,n) { const d=addCalendarMonths(Date.UTC(p.year,p.month-1,p.day),n);return {year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate()}; }
export function remaining(expires,now=Date.now()) {
  if(!expires || !Number.isFinite(new Date(expires).getTime()))return {expired:false,days:null,calendar:false,years:0,months:0,restDays:0};
  const end=new Date(expires).getTime(), a=parts(now), b=parts(end), days=Math.max(0,dayNumber(b)-dayNumber(a));
  if(end<=now)return {expired:true,days:0,calendar:false,years:0,months:0,restDays:0};
  const calendar=dayNumber(b)>dayNumber(addPartsMonths(a,1));
  let months=(b.year-a.year)*12+b.month-a.month;
  if(dayNumber(addPartsMonths(a,months))>dayNumber(b))months--;
  months=Math.max(0,months);return {expired:false,days,calendar,years:Math.floor(months/12),months:months%12,restDays:Math.max(0,dayNumber(b)-dayNumber(addPartsMonths(a,months)))};
}
export const expiryLabel = date => new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'long',year:'numeric'}).format(new Date(date));
