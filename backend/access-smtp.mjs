const unavailable=()=>Error('Access email configuration unavailable.');
export function smtpAccessTransport({host,port,user,password,from,loadMailer=()=>import('nodemailer')}){
 return {kind:'smtp',async send({to,subject,text,idempotencyKey,signal}){
  let transporter;const abort=()=>transporter?.close();
  try{if(signal?.aborted)throw unavailable();const mailer=await loadMailer();transporter=(mailer.default||mailer).createTransport({host,port,secure:port===465,requireTLS:true,tls:{servername:host,rejectUnauthorized:true,minVersion:'TLSv1.2'},auth:{user,pass:password},pool:false,logger:false,debug:false,connectionTimeout:5000,greetingTimeout:5000,socketTimeout:8000,disableFileAccess:true,disableUrlAccess:true});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)throw unavailable();const info=await transporter.sendMail({from,to,subject,text,messageId:'<'+idempotencyKey+'@'+from.split('@')[1]+'>',envelope:{from,to:[to]},disableFileAccess:true,disableUrlAccess:true});if(signal?.aborted||info?.accepted?.length!==1||String(info.accepted[0]).toLowerCase()!==to.toLowerCase()||info.rejected?.length)throw unavailable();return {accepted:true};}catch{throw unavailable();}finally{signal?.removeEventListener('abort',abort);transporter?.close();}
 }};
}
