import test from 'node:test';
import assert from 'node:assert/strict';
import {accessMailConfiguration,resendAccessTransport} from '../backend/access-mail.mjs';
import {smtpAccessTransport} from '../backend/access-smtp.mjs';
test('SMTP requires TLS verification, uses one envelope recipient, disables file/URL access and redacts failures',async()=>{
 for(const port of [465,587]){let options,mail,closed=0;const loadMailer=async()=>({createTransport:o=>{options=o;return {sendMail:async m=>{mail=m;return {accepted:['recipient@example.test'],rejected:[]};},close(){closed++;}};}});const transport=smtpAccessTransport({host:'smtp.example.test',port,user:'sender@example.test',password:'fixture-only',from:'sender@example.test',loadMailer});assert.deepEqual(await transport.send({to:'recipient@example.test',subject:'Synthetic',text:'Fixture',idempotencyKey:'access-mail-fixture'}),{accepted:true});assert.equal(options.secure,port===465);assert.equal(options.requireTLS,true);assert.equal(options.tls.rejectUnauthorized,true);assert.equal(options.tls.minVersion,'TLSv1.2');assert.equal(options.debug,false);assert.equal(options.logger,false);assert.equal(options.disableFileAccess,true);assert.deepEqual(mail.envelope,{from:'sender@example.test',to:['recipient@example.test']});assert.equal(mail.disableUrlAccess,true);assert.equal(closed,1);}
 const loadMailer=async()=>({createTransport:()=>({sendMail:async()=>{throw Error('Private SMTP credential diagnostics');},close(){}})});await assert.rejects(smtpAccessTransport({host:'smtp.example.test',port:465,user:'sender@example.test',password:'fixture-only',from:'sender@example.test',loadMailer}).send({to:'recipient@example.test',subject:'Fixture',text:'Fixture',idempotencyKey:'fixture'}),/^Error: Access email configuration unavailable\.$/);
});
test('disabled email never reads secrets; enabling requires reviewed metadata before secret lookup',()=>{
 const fsImpl=new Proxy({}, {get(){throw Error('Secret lookup forbidden');}});
 assert.deepEqual(accessMailConfiguration({}, {}, {fsImpl}),{enabled:false});
 for(const env of [{SIM_ACCESS_EMAIL_ENABLED:'true'},{SIM_ACCESS_EMAIL_ENABLED:'true',SIM_ACCESS_EMAIL_REVIEWED:'true',SIM_MAIL_PROVIDER:'resend',SIM_MAIL_FROM:'bad\naddress@example.test'}])assert.throws(()=>accessMailConfiguration(env,{}, {fsImpl}),/^Error: Access email configuration unavailable\.$/);
});
test('candidate provider sends only transactional text to one recipient and redacts all failures',async()=>{
 let call;const transport=resendAccessTransport({apiKey:'fixture-only-not-a-real-key',from:'sender@example.test',fetchImpl:async(url,options)=>{call={url,options};return new Response(JSON.stringify({id:'synthetic-message'}));}});
 assert.deepEqual(await transport.send({to:'recipient@example.test',subject:'Synthetic',text:'Fixture text',idempotencyKey:'fixture-job'}),{accepted:true});
 assert.equal(call.url,'https://api.resend.com/emails');assert.equal(call.options.redirect,'error');assert.deepEqual(JSON.parse(call.options.body),{from:'sender@example.test',to:['recipient@example.test'],subject:'Synthetic',text:'Fixture text'});assert.equal(call.options.headers['Idempotency-Key'],'fixture-job');
 for(const fetchImpl of [async()=>{throw Error('private provider diagnostics');},async()=>new Response('x'.repeat(2049)),async()=>new Response('{"id":"fixture"}',{status:400}),async()=>new Response('{}')])await assert.rejects(resendAccessTransport({apiKey:'synthetic',from:'sender@example.test',fetchImpl}).send({to:'recipient@example.test',subject:'Synthetic',text:'Fixture',idempotencyKey:'fixture'}),/^Error: Access email configuration unavailable\.$/);
});
