export const REFUND_TIMEZONE='America/Sao_Paulo';
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:REFUND_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function localStamp(ms){const p=Object.fromEntries(formatter.formatToParts(ms).map(x=>[x.type,x.value]));return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)+((ms%1000)+1000)%1000;}
// Seven calendar days at the same local time. Missing anchors never silently expire a right.
export function refundWindow(purchasedAt,now=Date.now()){
 if(!Number.isSafeInteger(purchasedAt)||!Number.isSafeInteger(now)||purchasedAt<=0)return {status:'anchor_pending',deadline:null,timeZone:REFUND_TIMEZONE};
 const target=localStamp(purchasedAt)+7*86400000;let deadline=target;
 for(let n=0;n<4;n++)deadline+=target-localStamp(deadline);
 if(localStamp(deadline)!==target)return {status:'anchor_pending',deadline:null,timeZone:REFUND_TIMEZONE};
 return {status:now<purchasedAt?'anchor_pending':now<=deadline?'within_window':'outside_window',deadline,timeZone:REFUND_TIMEZONE};
}
