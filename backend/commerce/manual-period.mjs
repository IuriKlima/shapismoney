import {commerceError} from './catalog.mjs';
const tz='America/Sao_Paulo';
const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function parts(ms){return Object.fromEntries(fmt.formatToParts(ms).filter(x=>x.type!=='literal').map(x=>[x.type,+x.value]));}
function stamp(p){return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);}
function instant(p){const target=stamp(p);let result=target;for(let i=0;i<4;i++)result+=target-stamp(parts(result));if(stamp(parts(result))!==target)throw commerceError(409,'Data local ambígua; revisar vigência.');return result;}
export function addLocalDays(ms,days){const p=parts(ms),d=new Date(Date.UTC(p.year,p.month-1,p.day+days));return instant({...p,year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate()})+(ms%1000);}
export function protocolPeriod({releasedAt,currentEnd=null,months,policyConfirmed=false}){
 if(policyConfirmed!==true)throw commerceError(503,'Política de vigência na liberação do protocolo não habilitada.');
 if(!Number.isSafeInteger(releasedAt)||releasedAt<=0||currentEnd!==null&&(!Number.isSafeInteger(currentEnd)||currentEnd<=0)||![1,3,6].includes(months))throw commerceError(400,'Vigência inválida.');
 const start=Math.max(releasedAt,currentEnd||0),p=parts(start),month=new Date(Date.UTC(p.year,p.month-1+months,1));
 const day=Math.min(p.day,new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,0)).getUTCDate());
 const end=instant({...p,year:month.getUTCFullYear(),month:month.getUTCMonth()+1,day})+(start%1000);
 return {start,end,noticeAt:addLocalDays(end,-15),timeZone:tz};
}
export function renewalNotice(end,now=Date.now()){
 if(!Number.isSafeInteger(end))return {state:'dates_pending',visible:false};
 return {state:now>=end?'expired':now>=addLocalDays(end,-15)?'renew_soon':'active',visible:now>=addLocalDays(end,-15),end,noticeAt:addLocalDays(end,-15),automaticRenewal:false};
}
