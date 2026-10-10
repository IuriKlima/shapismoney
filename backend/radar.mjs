import {randomUUID,createHash} from 'node:crypto';
import {newToken,tokenHash} from './auth.mjs';
import {RADAR_VERSION,RADAR_CONSENT} from '../public/sim/radar-model.js';
const sha=value=>createHash('sha256').update(value).digest('hex');
export function radarFlow({store,now,deny,exact,text,email,read,security,orgId}){
  const cookieName=security.production?'__Host-sim_radar':'sim_radar';
  const cookie=token=>cookieName+'='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200'+(security.production?'; Secure':'');
  const record=async(id,event)=>store.run('INSERT INTO radar_events(run_id,event,created_at) VALUES (?,?,?) ON CONFLICT(run_id,event) DO NOTHING',id,event,now());
  async function rate(connection){const bucket=sha(connection.clientIP);await store.transaction(async()=>{const count=await store.get('INSERT INTO radar_limits(bucket,count,reset_at) VALUES (?,?,?) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN radar_limits.reset_at<=? THEN 1 ELSE radar_limits.count+1 END,reset_at=CASE WHEN radar_limits.reset_at<=? THEN ? ELSE radar_limits.reset_at END RETURNING count',bucket,1,now()+3600000,now(),now(),now()+3600000);if(count.count>30)deny(429,'Aguarde antes de tentar novamente.');});}
  async function current(req){const match=new RegExp('(?:^|;\\s*)'+cookieName+'=([A-Za-z0-9_-]{43})(?:;|$)').exec(req.headers.cookie||'');const run=match?await store.get('SELECT r.*,l.org_id FROM radar_runs r JOIN radar_leads l ON l.id=r.lead_id WHERE token_hash=? AND expires_at>?',tokenHash(match[1]),now()):null;if(!run||run.org_id!==orgId)deny(401,'Inicie um novo Radar para continuar.');return run;}
  async function publicRoute(req,connection,route){
    if(!route.startsWith('/api/local/radar/'))return null;
    if(!orgId||!await store.get('SELECT id FROM organizations WHERE id=?',orgId))deny(503,'O cadastro de interesse está indisponível. Tente novamente mais tarde.');
    if(req.method!=='POST')deny(405,'Método não permitido.');
    if(route==='/api/local/radar/register'){
      await rate(connection);const body=await read(req);exact(body,['name','email','phone','necessary','marketing','consentVersion','source']);
      const name=text(body.name,2,100),address=email(body.email),phone=text(body.phone,0,25);
      if(phone&&!/^\+?[\d ()-]{8,25}$/.test(phone))deny(400,'WhatsApp inválido.');
      if(body.necessary!==true||typeof body.marketing!=='boolean'||body.consentVersion!==RADAR_CONSENT||!['radar','plans'].includes(body.source))deny(400,'Confira a autorização para este cadastro.');
      const key=req.headers['idempotency-key'];if(typeof key!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(key))deny(400,'Chave de operação obrigatória.');const hash=sha(JSON.stringify(body));
      const token=newToken();await store.transaction(async()=>{
        await store.lockEmail('radar:'+orgId+':'+address);const previous=await store.get('SELECT * FROM radar_registrations WHERE operation_key=?',key);
        if(previous){if(previous.request_hash!==hash)deny(409,'Chave reutilizada para outro pedido.');const run=await store.get('SELECT * FROM radar_runs WHERE id=?',previous.run_id);if(run.expires_at<=now())deny(409,'Cadastro expirado. Inicie novamente.');await store.run('UPDATE radar_runs SET token_hash=? WHERE id=?',tokenHash(token),run.id);return;}
        const lead=await store.get('SELECT id FROM radar_leads WHERE org_id=? AND email=?',orgId,address);const leadId=lead?.id||randomUUID();
        if(lead)await store.run('UPDATE radar_leads SET name=?,phone=?,marketing=?,consent_version=?,updated_at=? WHERE id=?',name,phone,Number(body.marketing),body.consentVersion,now(),leadId);
        else await store.run('INSERT INTO radar_leads VALUES (?,?,?,?,?,?,?,?,?,?)',leadId,orgId,name,address,phone,Number(body.marketing),body.consentVersion,body.source,now(),now());
        const id=randomUUID();await store.run('INSERT INTO radar_runs VALUES (?,?,?,?,?,?,?,?)',id,leadId,tokenHash(token),now()+43200000,'registered',RADAR_VERSION,body.source,now());await record(id,'registration');await store.run('INSERT INTO radar_registrations VALUES (?,?,?)',key,hash,id);
      });return {status:201,data:{registered:true,version:RADAR_VERSION},cookie:cookie(token)};
    }
    const run=await current(req);
    if(route==='/api/local/radar/restart'){await rate(connection);const body=await read(req);exact(body,[]);const key=req.headers['idempotency-key'];if(typeof key!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(key))deny(400,'Chave de operação obrigatória.');const token=newToken();await store.transaction(async()=>{await store.lockEmail('radar-run:'+run.lead_id);const previous=await store.get('SELECT * FROM radar_registrations WHERE operation_key=?',key);const hash=sha('restart:'+run.lead_id);if(previous){if(previous.request_hash!==hash)deny(409,'Chave reutilizada.');await store.run('UPDATE radar_runs SET token_hash=? WHERE id=?',tokenHash(token),previous.run_id);return;}const id=randomUUID();await store.run('INSERT INTO radar_runs VALUES (?,?,?,?,?,?,?,?)',id,run.lead_id,tokenHash(token),now()+43200000,'registered',RADAR_VERSION,'radar',now());await record(id,'registration');await store.run('INSERT INTO radar_registrations VALUES (?,?,?)',key,hash,id);});return {status:201,data:{registered:true},cookie:cookie(token)};}
    if(route==='/api/local/radar/marketing'){const body=await read(req);exact(body,['enabled']);if(body.enabled!==false)deny(400,'Esta rota permite somente retirar autorização.');await store.run('UPDATE radar_leads SET marketing=0,updated_at=? WHERE id=?',now(),run.lead_id);return {status:200,data:{withdrawn:true}};}
    if(route==='/api/local/radar/event'){
      const body=await read(req);exact(body,['event','version']);const order=['registration','start','completion','result','cta'];if(body.version!==RADAR_VERSION||!order.slice(1).includes(body.event))deny(400,'Evento inválido.');
      await store.transaction(async()=>{await store.lockEmail('radar-run:'+run.lead_id);const live=await current(req);if(await store.get('SELECT event FROM radar_events WHERE run_id=? AND event=?',live.id,body.event))return;
        const previous=order[order.indexOf(body.event)-1];
        if(!(body.event==='cta'&&live.source==='plans')&&!await store.get('SELECT event FROM radar_events WHERE run_id=? AND event=?',live.id,previous))deny(409,'Conclua a etapa anterior.');await record(live.id,body.event);await store.run('UPDATE radar_runs SET state=? WHERE id=?',body.event,live.id);
      });return {status:200,data:{recorded:true}};
    }deny(404,'Recurso não encontrado.');
  }
  async function privateRoute(actor,req,route){if(route!=='/api/local/crm/radar'||req.method!=='GET')return null;if(actor.role!=='admin')deny(403,'CRM restrito à administração.');
    const leads=await store.all('SELECT id,name,email,phone,marketing,source,created_at,updated_at FROM radar_leads WHERE org_id=? ORDER BY updated_at DESC LIMIT 200',actor.org_id);
    for(const lead of leads){lead.marketing=Boolean(lead.marketing);lead.totalRuns=(await store.get('SELECT COUNT(*) AS n FROM radar_runs WHERE lead_id=?',lead.id)).n;lead.runs=await store.all('SELECT id,state,version,created_at FROM radar_runs WHERE lead_id=? ORDER BY created_at DESC LIMIT 50',lead.id);for(const run of lead.runs)run.events=await store.all('SELECT event,created_at FROM radar_events WHERE run_id=? ORDER BY created_at',run.id);}
    return {status:200,data:{leads}};
  }
  return {publicRoute,privateRoute};
}
