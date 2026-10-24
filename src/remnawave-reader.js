// Server-only read adapter. The authenticated backend supplies the user's stored panel ID.
// Version must be confirmed against the deployed panel before integration.
export class RemnawaveReader {
  constructor({baseUrl,token,fetcher=fetch}) {
    const u=new URL(baseUrl);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('Нужен HTTPS URL панели без учётных данных');
    if(!token)throw Error('Не задан серверный токен Remnawave');
    this.base=baseUrl.replace(/\/$/,'');this.token=token;this.fetcher=fetcher;
  }
  async read(path){
    let r;try{r=await this.fetcher(this.base+path,{headers:{Authorization:`Bearer ${this.token}`},signal:AbortSignal.timeout(8000),redirect:'error'});}catch{throw Error('Панель Remnawave недоступна');}
    if(!r.ok)throw Error(`Ошибка панели: HTTP ${r.status}`);
    const payload=await r.json();if(!payload.response)throw Error('Неизвестный формат ответа панели');return payload.response;
  }
  async subscriptionFor(panelUserId){
    // No lookup by a browser-supplied Telegram ID, email or panel ID.
    if(!/^[a-zA-Z0-9-]{1,64}$/.test(String(panelUserId)))throw Error('Некорректный сохранённый ID пользователя');
    const id=encodeURIComponent(panelUserId),u=await this.read(`/api/users/${id}`);
    if(typeof u.status!=='string'||!u.expireAt||!Number.isFinite(new Date(u.expireAt).getTime()))throw Error('Неизвестный формат статуса или срока панели');
    let hw=null;try{hw=await this.read(`/api/hwid/devices/${id}`);}catch{/* Unknown count is not zero. */}
    const devices=Array.isArray(hw?.devices)?hw.devices:null;
    return {status:u.status,expiresAt:u.expireAt,deviceLimit:u.hwidDeviceLimit??null,
      devicesUsed:devices?devices.length:null,
      devices:devices?.map(d=>({name:d.deviceModel??d.platform??'Устройство',platform:d.osVersion??d.platform??'',registered:true}))??[],
      // Never forward protocol passwords, raw HWIDs or complete panel responses to the browser.
      subscriptionUrl:u.status==='ACTIVE'?u.subscriptionUrl??null:null,syncedAt:new Date().toISOString()};
  }
}
