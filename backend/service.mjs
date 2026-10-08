import {invitationFlow} from './invitations.mjs';
import {assertRequest,localSecurity,cookieHeader} from './security.mjs';
import {createDevAIHandler} from '../prototype/dev-ai.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {hashPassword,verifyPassword,newToken,tokenHash} from './auth.mjs';
class Failure extends Error{constructor(status,message){super(message);this.status=status;}}
const deny=(status,message)=>{throw new Failure(status,message);};
const exact=(data,keys)=>{if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).sort().join(',')!==keys.slice().sort().join(','))deny(400,'Campos inválidos.');};
const text=(value,min,max)=>{if(typeof value!=='string'||value.trim().length<min||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))deny(400,'Texto inválido.');return value.trim();};
const email=value=>{const v=text(value,3,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))deny(400,'E-mail inválido.');return v;};
const publicUser=u=>({id:u.id,name:u.name,email:u.email,role:u.role});
const publicPlan=p=>({id:p.id,title:p.title,content:JSON.parse(p.content),status:p.status,revision:p.revision});
export async function createLocalService({store,now=Date.now,sessionMs=8*60*60*1000,loginLimit=8,security=localSecurity(),ai={}}={}){
  const dummy=await hashPassword(newToken());
  const askAI=createDevAIHandler({...ai,guard:req=>assertRequest(req,security),cors:false});
  const audit=async(actor,student,event)=>await store.run('INSERT INTO audit VALUES (?,?,?,?,?,?)',randomUUID(),actor.org_id,actor.id,student,event,now());
  async function session(req){
    const match=new RegExp('(?:^|;\\s*)'+security.cookieName+'=([A-Za-z0-9_-]{43})(?:;|$)').exec(req.headers.cookie||'');
    if(!match)return null;
    const user=await store.get('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1',tokenHash(match[1]),now());
    return user?{user,hash:tokenHash(match[1])}:null;
  }
  async function student(actor,id){
    const row=await store.get('SELECT * FROM students WHERE id=? AND org_id=?',id,actor.org_id);
    if(!row||!(actor.role==='admin'||actor.role==='coach'&&row.coach_id===actor.id||actor.role==='nutrition'&&row.nutrition_id===actor.id||actor.role==='student'&&row.user_id===actor.id))deny(404,'Aluno não encontrado.');
    return row;
  }
  function studentDTO(row,actor){const result={id:row.id,name:row.name,email:row.email,onboarding:JSON.parse(row.onboarding),revision:row.revision};if(actor.role!=='student')result.internalNote=row.internal_note;return result;}
  function trainingManager(actor,row){if(actor.org_id!==row.org_id||!(actor.role==='admin'||actor.role==='coach'&&row.coach_id===actor.id))deny(403,'Treino exige administrador da organização ou personal responsável.');}
  async function list(actor){
    if(actor.role==='admin')return await store.all('SELECT * FROM students WHERE org_id=? ORDER BY name',actor.org_id);
    const column={coach:'coach_id',nutrition:'nutrition_id',student:'user_id'}[actor.role];if(!column)deny(403,'Papel inválido.');
    return await store.all('SELECT * FROM students WHERE org_id=? AND '+column+'=? ORDER BY name',actor.org_id,actor.id);
  }
  async function mutation(actor,req,body,work){
    const key=req.headers['idempotency-key'];if(typeof key!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(key))deny(400,'Chave de operação obrigatória.');
    const hash=createHash('sha256').update(req.method+' '+req.url+' '+JSON.stringify(body)).digest('hex');
    return await store.transaction(async()=>{await store.lockActor(actor.id);const previous=await store.get('SELECT * FROM operations WHERE actor_id=? AND operation_key=?',actor.id,key);if(previous){if(previous.request_hash!==hash)deny(409,'Chave reutilizada para outro pedido.');return {status:previous.status,data:JSON.parse(previous.result)};}
      const result=await work();await store.run('INSERT INTO operations VALUES (?,?,?,?,?)',actor.id,key,hash,result.status,JSON.stringify(result.data));return result;});
  }
  async function saveOnboarding(actor,req,row,body,event){
    exact(body,['goal','days','experience','context','revision']);
    if(!['Hipertrofia','Condicionamento','Qualidade de vida'].includes(body.goal)||!Number.isInteger(body.days)||body.days<1||body.days>7||!['Iniciante','Intermediário','Avançado'].includes(body.experience))deny(400,'Respostas inválidas.');
    const context=text(body.context,0,1000);
    return await mutation(actor,req,body,async()=>{const current=await student(actor,row.id);if(body.revision!==current.revision)deny(409,'Dados mudaram. Recarregue antes de salvar.');
      const updated=await store.run('UPDATE students SET onboarding=?,revision=revision+1 WHERE id=? AND org_id=? AND revision=?',JSON.stringify({goal:body.goal,days:body.days,experience:body.experience,context}),row.id,actor.org_id,body.revision);
      if(updated.changes!==1)deny(409,'Dados mudaram. Recarregue antes de salvar.');
      await audit(actor,row.id,event);return {status:200,data:{student:studentDTO(await student(actor,row.id),actor)}};});
  }
  async function read(req){
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))deny(415,'Envie JSON.');
    if(Number(req.headers['content-length']||0)>16384)deny(413,'Limite de entrada: 16 KB.');
    let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>16384)deny(413,'Limite de entrada: 16 KB.');chunks.push(chunk);}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{deny(400,'JSON inválido.');}
  }
  const invites=invitationFlow({store,now,audit,deny,exact,email,text,read,mutation,student});
  return async function handle(req,res){
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    try{
      const connection=assertRequest(req,security);
      const url=new URL(req.url,'http://127.0.0.1');const route=url.pathname;
      if(!['GET','POST','PUT'].includes(req.method))deny(405,'Método não permitido.');
      if(route==='/api/local/login'&&req.method==='POST'){
        const body=await read(req);exact(body,['email','password']);const address=email(body.email);if(typeof body.password!=='string'||body.password.length>128)deny(400,'Credenciais inválidas.');
        await store.transaction(async()=>{
          for(const bucket of ['ip:'+connection.clientIP,'account:'+address]){
            const attempt=await store.get('INSERT INTO login_attempts(bucket,count,reset_at) VALUES (?,?,?) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN login_attempts.reset_at<=? THEN 1 ELSE login_attempts.count+1 END,reset_at=CASE WHEN login_attempts.reset_at<=? THEN ? ELSE login_attempts.reset_at END RETURNING count,reset_at',bucket,1,now()+900000,now(),now(),now()+900000);
            if(attempt.count>loginLimit)deny(429,'Aguarde antes de tentar novamente.');
          }
        });
        const user=await store.get('SELECT * FROM users WHERE email=? AND active=1',address);const valid=await verifyPassword(body.password,user?.password_hash||dummy);if(!valid||!user)deny(401,'E-mail ou senha inválidos.');
        const old=await session(req);if(old)await store.run('DELETE FROM sessions WHERE token_hash=?',old.hash);
        const token=newToken();await store.transaction(async()=>{await store.run('DELETE FROM sessions WHERE expires_at<=?',now());await store.run('INSERT INTO sessions VALUES (?,?,?)',tokenHash(token),user.id,now()+sessionMs);await audit(user,null,'login');});
        // HTTP loopback only. Production must use HTTPS + Secure + __Host- cookie.
        res.setHeader('Set-Cookie',cookieHeader(security,token,Math.floor(sessionMs/1000)));return send(200,{user:publicUser(user)});
      }
      if(route==='/api/local/activate'&&req.method==='POST'){const result=await invites.activate(req,connection);return send(result.status,result.data);}
      const auth=await session(req);if(!auth)deny(401,'Entre para continuar.');const actor=auth.user;
      if(route==='/api/local/ai'&&req.method==='POST'){if(!['coach','nutrition'].includes(actor.role))deny(403,'IA restrita a profissionais autenticados.');return await askAI(req,res);}
      if(route==='/api/local/session'&&req.method==='GET')return send(200,{user:publicUser(actor)});
      if(route==='/api/local/logout'&&req.method==='POST'){
        const body=await read(req);exact(body,[]);await store.transaction(async()=>{await store.run('DELETE FROM sessions WHERE token_hash=?',auth.hash);await audit(actor,null,'logout');});res.setHeader('Set-Cookie',cookieHeader(security,'',0));return send(200,{loggedOut:true});
      }
      if(route==='/api/local/invitations'&&req.method==='POST'){const result=await invites.create(actor,req);return send(result.status,result.data);}
      if(route==='/api/local/students'&&req.method==='GET')return send(200,{students:(await list(actor)).map(row=>studentDTO(row,actor))});
      if(route==='/api/local/students'&&req.method==='POST'){
        if(!['admin','coach'].includes(actor.role))deny(403,'Cadastro exige administrador da organização ou personal responsável.');const body=await read(req);exact(body,['name','email','internalNote']);const name=text(body.name,2,100),address=email(body.email),note=text(body.internalNote,0,1000);
        const result=await mutation(actor,req,body,async()=>{if(await store.get('SELECT id FROM students WHERE org_id=? AND email=?',actor.org_id,address))deny(409,'Este e-mail já está cadastrado.');const id=randomUUID();await store.run('INSERT INTO students(id,org_id,coach_id,email,name,internal_note) VALUES (?,?,?,?,?,?)',id,actor.org_id,actor.id,address,name,note);await audit(actor,id,'student.created');return {status:201,data:{student:studentDTO(await student(actor,id),actor),accountProvisioned:false}};});return send(result.status,result.data);
      }
      if(route==='/api/local/onboarding'&&req.method==='PUT'){
        if(actor.role!=='student')deny(403,'Onboarding pertence ao aluno.');const row=await store.get('SELECT * FROM students WHERE user_id=? AND org_id=?',actor.id,actor.org_id);if(!row)deny(404,'Vínculo de aluno pendente.');
        const result=await saveOnboarding(actor,req,row,await read(req),'onboarding.saved');return send(result.status,result.data);
      }
      const studentMatch=/^\/api\/local\/students\/([a-f0-9-]{36})(\/plans|\/onboarding)?$/.exec(route);
      if(studentMatch){const row=await student(actor,studentMatch[1]);
        if(!studentMatch[2]&&req.method==='GET')return send(200,{student:studentDTO(row,actor)});
        if(studentMatch[2]==='/onboarding'&&req.method==='PUT'){trainingManager(actor,row);const result=await saveOnboarding(actor,req,row,await read(req),'onboarding.recorded');return send(result.status,result.data);}
        if(studentMatch[2]==='/plans'&&req.method==='GET'){const plans=await store.all('SELECT * FROM plans WHERE student_id=?'+(actor.role==='student'?" AND status='published'":'')+' ORDER BY id DESC',row.id);return send(200,{plans:plans.map(publicPlan)});}
        if(studentMatch[2]==='/plans'&&req.method==='POST'){
          trainingManager(actor,row);const body=await read(req);exact(body,['title','exercises']);const title=text(body.title,2,100);if(!Array.isArray(body.exercises)||body.exercises.length<1||body.exercises.length>12)deny(400,'Use 1–12 exercícios.');
          const exercises=body.exercises.map(e=>{exact(e,['name','sets','reps']);if(!Number.isInteger(e.sets)||e.sets<1||e.sets>10||!Number.isInteger(e.reps)||e.reps<1||e.reps>50)deny(400,'Séries ou repetições inválidas.');return {name:text(e.name,2,100),sets:e.sets,reps:e.reps};});
          const result=await mutation(actor,req,body,async()=>{const id=randomUUID();await store.run('INSERT INTO plans(id,student_id,author_id,title,content,status) VALUES (?,?,?,?,?,?)',id,row.id,actor.id,title,JSON.stringify({exercises}),'draft');await audit(actor,row.id,'plan.drafted');return {status:201,data:{plan:publicPlan(await store.get('SELECT * FROM plans WHERE id=?',id))}};});return send(result.status,result.data);
        }
      }
      const planMatch=/^\/api\/local\/plans\/([a-f0-9-]{36})\/(submit|approve|publish)$/.exec(route);
      if(planMatch&&req.method==='POST'){
        const plan=await store.get('SELECT * FROM plans WHERE id=?',planMatch[1]);if(!plan)deny(404,'Plano não encontrado.');const row=await student(actor,plan.student_id);trainingManager(actor,row);const body=await read(req);exact(body,['revision']);
        const result=await mutation(actor,req,body,async()=>{const current=await store.get('SELECT * FROM plans WHERE id=?',plan.id);if(body.revision!==current.revision)deny(409,'Plano mudou. Recarregue.');
          const action=planMatch[2];const required={submit:'draft',approve:'review',publish:'approved'}[action];if(current.status!==required)deny(409,'Revisão profissional obrigatória antes de publicar.');
          let updated;
          if(action==='approve')updated=await store.run("UPDATE plans SET status='approved',approved_by=?,approved_revision=revision,revision=revision+1 WHERE id=? AND revision=? AND status=?",actor.id,plan.id,body.revision,required);
          else if(action==='publish'){if(!current.approved_by||current.approved_revision!==current.revision-1)deny(409,'Aprovação desatualizada.');updated=await store.run("UPDATE plans SET status='published',published_at=?,revision=revision+1 WHERE id=? AND revision=? AND status=?",now(),plan.id,body.revision,required);}
          else updated=await store.run("UPDATE plans SET status='review',revision=revision+1 WHERE id=? AND revision=? AND status=?",plan.id,body.revision,required);
          if(updated.changes!==1)deny(409,'Plano mudou. Recarregue.');
          await audit(actor,row.id,'plan.'+action);return {status:200,data:{plan:publicPlan(await store.get('SELECT * FROM plans WHERE id=?',plan.id))}};});return send(result.status,result.data);
      }
      if(route==='/api/local/audit'&&req.method==='GET'){
        if(actor.role==='student')deny(403,'Auditoria restrita à equipe.');const ids=(await list(actor)).map(s=>s.id);const rows=(await store.all('SELECT id,actor_id,student_id,event,created_at FROM audit WHERE org_id=? ORDER BY created_at DESC LIMIT 100',actor.org_id)).filter(a=>actor.role==='admin'||a.actor_id===actor.id||ids.includes(a.student_id));return send(200,{audit:rows});
      }
      deny(404,'Recurso não encontrado. Uploads ainda indisponíveis.');
    }catch(error){const code=error instanceof Failure||error.safe===true?error.status:['23505','SQLITE_CONSTRAINT_UNIQUE'].includes(error.code)?409:500;send(code,{error:error instanceof Failure||error.safe===true?error.message:code===409?'Este cadastro ou operação já existe.':'Não foi possível concluir a operação.'});}
  };
}
