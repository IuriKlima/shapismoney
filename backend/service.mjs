import {accessPolicy} from './access-policy.mjs';
import {passwordAccessFlow} from './password-access.mjs';
import {manualTrainingFlow,publicTrainingContent} from './manual-training.mjs';
import {trainingSafety} from './training-safety.mjs';
import {trainingProposalFlow} from './training-proposals.mjs';
import {supervisionFlow} from './supervision.mjs';
import {anamnesisFlow} from './anamnesis.mjs';
import {serviceFlow} from './service-sla.mjs';
import {monthlyBudget} from './ai-monthly-budget.mjs';
import {nutritionFlow} from './nutrition.mjs';
import {aiChatFlow} from './ai-chat.mjs';
import {executionFlow} from './execution.mjs';
import {invitationFlow} from './invitations.mjs';
import {assertRequest,localSecurity,cookieHeader} from './security.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {hashPassword,verifyPassword,newToken,tokenHash} from './auth.mjs';
class Failure extends Error{constructor(status,message){super(message);this.status=status;}}
const deny=(status,message)=>{throw new Failure(status,message);};
const exact=(data,keys)=>{if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).sort().join(',')!==keys.slice().sort().join(','))deny(400,'Campos inválidos.');};
const text=(value,min,max)=>{if(typeof value!=='string'||value.trim().length<min||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))deny(400,'Texto inválido.');return value.trim();};
const email=value=>{const v=text(value,3,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))deny(400,'E-mail inválido.');return v;};
const publicUser=u=>({id:u.id,name:u.name,email:u.email,role:u.role});
const publicPlan=p=>({id:p.id,title:p.title,content:publicTrainingContent(JSON.parse(p.content)),status:p.status,revision:p.revision});
export async function createLocalService({store,now=Date.now,sessionMs=8*60*60*1000,loginLimit=8,security=localSecurity(),chat={},trainingProposals={},accessEmail={}}={}){
  const dummy=await hashPassword(newToken());
  const audit=async(actor,student,event)=>await store.run('INSERT INTO audit VALUES (?,?,?,?,?,?)',randomUUID(),actor.org_id,actor.id,student,event,now());
  const access=accessPolicy({store,now,deny,audit});
  const userDTO=async u=>({...publicUser(u),...(u.role==='student'?{access:await access.userSummary(u)}:{})});
  async function session(req){
    const match=new RegExp('(?:^|;\\s*)'+security.cookieName+'=([A-Za-z0-9_-]{43})(?:;|$)').exec(req.headers.cookie||'');
    if(!match)return null;
    const user=await store.get('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1',tokenHash(match[1]),now());
    return user?{user,hash:tokenHash(match[1])}:null;
  }
  async function student(actor,id){
    const row=await store.get('SELECT s.*,c.role AS coach_role FROM students s JOIN users c ON c.id=s.coach_id WHERE s.id=? AND s.org_id=?',id,actor.org_id);
    if(!row||!(actor.role==='admin'||actor.role==='coach'&&row.coach_id===actor.id||actor.role==='nutrition'&&row.nutrition_id===actor.id||actor.role==='student'&&row.user_id===actor.id))deny(404,'Aluno não encontrado.');
    if(actor.role==='student')await access.assertActive(row);
    return row;
  }
  function studentDTO(row,actor){const result={id:row.id,name:row.name,email:row.email,onboarding:JSON.parse(row.onboarding),revision:row.revision};if(actor.role!=='student')result.internalNote=row.internal_note;if(actor.role==='admin')result.assignments={coachId:row.coach_role==='coach'?row.coach_id:null,nutritionId:row.nutrition_id};return result;}
  function trainingManager(actor,row){if(actor.org_id!==row.org_id||!(actor.role==='admin'||actor.role==='coach'&&row.coach_id===actor.id))deny(403,'Treino exige administrador da organização ou personal responsável.');}
  async function list(actor){
    if(actor.role==='admin')return await store.all('SELECT s.*,c.role AS coach_role FROM students s JOIN users c ON c.id=s.coach_id WHERE s.org_id=? ORDER BY s.name',actor.org_id);
    const column={coach:'coach_id',nutrition:'nutrition_id',student:'user_id'}[actor.role];if(!column)deny(403,'Papel inválido.');
    const rows=await store.all('SELECT s.*,c.role AS coach_role FROM students s JOIN users c ON c.id=s.coach_id WHERE s.org_id=? AND s.'+column+'=? ORDER BY s.name',actor.org_id,actor.id);if(actor.role==='student')for(const row of rows)await access.assertActive(row);return rows;
  }
  async function mutation(actor,req,body,work){
    const key=req.headers['idempotency-key'];if(typeof key!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(key))deny(400,'Chave de operação obrigatória.');
    const hash=createHash('sha256').update(req.method+' '+req.url+' '+JSON.stringify(body)).digest('hex');
    return await store.transaction(async()=>{await store.lockActor(actor.id);const currentActor=await store.get('SELECT active,role,org_id FROM users WHERE id=?',actor.id),live=await session(req);if(!currentActor?.active||currentActor.role!==actor.role||currentActor.org_id!==actor.org_id||live?.user.id!==actor.id)deny(401,'Acesso ou sessão mudou. Entre novamente.');const previous=await store.get('SELECT * FROM operations WHERE actor_id=? AND operation_key=?',actor.id,key);if(previous){if(previous.request_hash!==hash)deny(409,'Chave reutilizada para outro pedido.');return {status:previous.status,data:JSON.parse(previous.result)};}
      const result=await work();await store.run('INSERT INTO operations VALUES (?,?,?,?,?)',actor.id,key,hash,result.status,JSON.stringify(result.data));return result;});
  }
  async function saveOnboarding(actor,req,row,body,event){
    exact(body,['goal','days','experience','context','revision']);
    if(!['Hipertrofia','Condicionamento','Qualidade de vida'].includes(body.goal)||!Number.isInteger(body.days)||body.days<1||body.days>7||!['Iniciante','Intermediário','Avançado'].includes(body.experience))deny(400,'Respostas inválidas.');
    const context=text(body.context,0,1000);
    return await mutation(actor,req,body,async()=>{await store.lockStudent(row.id);const current=await student(actor,row.id);if(body.revision!==current.revision)deny(409,'Dados mudaram. Recarregue antes de salvar.');
      const updated=await store.run('UPDATE students SET onboarding=?,revision=revision+1 WHERE id=? AND org_id=? AND revision=?',JSON.stringify({goal:body.goal,days:body.days,experience:body.experience,context}),row.id,actor.org_id,body.revision);
      if(updated.changes!==1)deny(409,'Dados mudaram. Recarregue antes de salvar.');
      await audit(actor,row.id,event);await sla.changed(actor,row.id,body.revision+1);return {status:200,data:{student:studentDTO(await student(actor,row.id),actor)}};});
  }
  async function read(req,limit=16384){
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))deny(415,'Envie JSON.');
    if(Number(req.headers['content-length']||0)>limit)deny(413,'Limite de entrada excedido.');
    let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)deny(413,'Limite de entrada excedido.');chunks.push(chunk);}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{deny(400,'JSON inválido.');}
  }
  function studentWork(actor,body){
        if(!['admin','coach'].includes(actor.role))deny(403,'Cadastro exige administrador da organização ou personal responsável.');const manual=Object.hasOwn(body,'accessLevel');exact(body,['name','email',...(Object.hasOwn(body,'internalNote')?['internalNote']:[]),...(manual?['accessLevel','accessExpiresAt','accessConfirmed']:[])]);const name=text(body.name,2,100),address=email(body.email),note=text(body.internalNote??'',0,1000);if(manual){if(actor.role!=='admin')deny(403,'Nível de acesso exige administrador.');if(body.accessConfirmed!==true)deny(400,'Confirme o acesso manual.');access.validate(body.accessLevel,body.accessExpiresAt);}

    return async()=>{await store.lockEmail(address);if(await store.get('SELECT id FROM students WHERE org_id=? AND email=?',actor.org_id,address))deny(409,'Este e-mail já está cadastrado.');if(manual){const existing=await store.get('SELECT org_id,role FROM users WHERE email=?',address);if(existing&&(existing.org_id!==actor.org_id||existing.role!=='student'))deny(409,'Vínculo de acesso indisponível para este cadastro.');}const id=randomUUID();await store.run('INSERT INTO students(id,org_id,coach_id,email,name,internal_note) VALUES (?,?,?,?,?,?)',id,actor.org_id,actor.id,address,name,note);await audit(actor,id,'student.created');const row=await student(actor,id);let grant,welcomeQueued=false;if(manual){grant=await access.grantLocked(actor,row,{level:body.accessLevel,expiresAt:body.accessExpiresAt});welcomeQueued=await passwordAccess.welcomeLocked(actor,row,grant);}return {status:201,data:{student:studentDTO(row,actor),accountProvisioned:false,...(manual?{access:grant,welcomeQueued,emailAvailable:passwordAccess.available()}: {})}};};
  }
  async function planWork(actor,id,body){
    const row=await student(actor,id);
          trainingManager(actor,row);exact(body,[...(['title','exercises']),...(Object.hasOwn(body,'daysPerWeek')?['daysPerWeek']:[]),...(Object.hasOwn(body,'instructions')?['instructions']:[])]);const instructions=Object.hasOwn(body,'instructions')?text(body.instructions,0,2000):'';const daysPerWeek=body.daysPerWeek??3;if(!Number.isInteger(daysPerWeek)||daysPerWeek<1||daysPerWeek>7)deny(400,'Frequência semanal inválida.');const title=text(body.title,2,100);if(!Array.isArray(body.exercises)||body.exercises.length<1||body.exercises.length>12)deny(400,'Use 1–12 exercícios.');
          const exercises=body.exercises.map(e=>{exact(e,['name','sets','reps']);if(!Number.isInteger(e.sets)||e.sets<1||e.sets>10||!Number.isInteger(e.reps)||e.reps<1||e.reps>50)deny(400,'Séries ou repetições inválidas.');return {name:text(e.name,2,100),sets:e.sets,reps:e.reps};});

    return async()=>{await store.lockStudent(row.id);trainingManager(actor,await student(actor,row.id));const id=randomUUID();await store.run('INSERT INTO plans(id,student_id,author_id,title,content,status) VALUES (?,?,?,?,?,?)',id,row.id,actor.id,title,JSON.stringify({exercises,daysPerWeek,...(instructions?{instructions}:{})}),'draft');await audit(actor,row.id,'plan.drafted');return {status:201,data:{plan:publicPlan(await store.get('SELECT * FROM plans WHERE id=?',id))}};};
  }
  const passwordAccess=passwordAccessFlow({store,now,deny,exact,email,text,read,audit,mutation,student,policy:access,security,configuration:accessEmail});
  const manualTraining=manualTrainingFlow({store,deny,exact,text,read,mutation,student,trainingManager,audit,publicPlan});
  const intake=anamnesisFlow({store,now,deny,exact,read,mutation,student,audit,changed:(...args)=>sla.changed(...args,'anamnesis'),start:(...args)=>sla.start(...args)});
  const sla=serviceFlow({store,now,deny,exact,text,read,mutation,student,audit,intakeState:intake.state});
  const budget=monthlyBudget({store,now,deny,exact,text,read,mutation,student,audit,configuration:chat});
  const trainingSafetyFlow=trainingSafety({store,now,deny,exact,text,read,mutation,student,audit,externalEnabled:()=>!security.production&&trainingProposals.enabled===true&&trainingProposals.externalGate===true&&trainingProposals.mode==='external-reviewed'});
  const trainingProposal=trainingProposalFlow({store,now,deny,exact,text,read,mutation,student,audit,safety:trainingSafetyFlow,security,configuration:trainingProposals,budgetConfiguration:trainingProposals.mode==='external-reviewed'?trainingProposals.budget||{}:chat});
  const chatFlow=aiChatFlow({store,now,deny,exact,text,read,mutation,student,audit,studentWork,planWork,budget,configuration:chat});
  const nutrition=nutritionFlow({store,now,deny,exact,text,read,mutation,student:async(actor,id)=>{const row=await student(actor,id);if(actor.role==='student')await access.assertActive(row,'nutrition');return row;},audit});
  const supervision=supervisionFlow({store,now,deny,exact,text,read,mutation,student,audit,serviceSnapshot:sla.snapshot});
  const execution=executionFlow({store,now,audit,deny,exact,text,read,mutation,student});
  const invites=invitationFlow({store,now,audit,deny,exact,email,text,read,mutation,student,canActivate:async row=>{await access.assertActive(row);}});
  const handle=async function handle(req,res){
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
        const token=newToken();const authenticated=await store.transaction(async()=>{await store.lockActor(user.id);const current=await store.get('SELECT * FROM users WHERE id=?',user.id);if(!current?.active||current.email!==address||current.password_hash!==user.password_hash)deny(401,'E-mail ou senha inválidos.');const old=await session(req);if(old)await store.run('DELETE FROM sessions WHERE token_hash=?',old.hash);await store.run('DELETE FROM sessions WHERE expires_at<=?',now());await store.run('INSERT INTO sessions VALUES (?,?,?)',tokenHash(token),current.id,now()+sessionMs);await audit(current,null,'login');return current;});
        // HTTP loopback only. Production must use HTTPS + Secure + __Host- cookie.
        res.setHeader('Set-Cookie',cookieHeader(security,token,Math.floor(sessionMs/1000)));return send(200,{user:await userDTO(authenticated)});
      }
      if(route==='/api/local/activate'&&req.method==='POST'){const result=await invites.activate(req,connection);return send(result.status,result.data);}
      const passwordResult=await passwordAccess.handlePublic(req,connection,route);if(passwordResult){if(passwordResult.clearSession)res.setHeader('Set-Cookie',cookieHeader(security,'',0));return send(passwordResult.status,passwordResult.data);}
      const auth=await session(req);if(!auth)deny(401,'Entre para continuar.');const actor=auth.user;
      const accessResult=await passwordAccess.handle(actor,req,route);if(accessResult)return send(accessResult.status,accessResult.data);
      const manualResult=await manualTraining.handle(actor,req,route);if(manualResult){if(manualResult.binary){res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+manualResult.filename+'"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"});return res.end(manualResult.binary);}return send(manualResult.status,manualResult.data);}
      const safetyResult=await trainingSafetyFlow.handle(actor,req,route);if(safetyResult)return send(safetyResult.status,safetyResult.data);
      const proposalResult=await trainingProposal.handle(actor,auth,req,route);if(proposalResult)return send(proposalResult.status,proposalResult.data);
      const intakeResult=await intake.handle(actor,req,route);if(intakeResult)return send(intakeResult.status,intakeResult.data);
      const supervisionResult=await supervision.handle(actor,req,route);if(supervisionResult)return send(supervisionResult.status,supervisionResult.data);
      const serviceResult=await sla.handle(actor,req,route);if(serviceResult)return send(serviceResult.status,serviceResult.data);
      const budgetResult=await budget.handle(actor,req,route);if(budgetResult)return send(budgetResult.status,budgetResult.data);
      const chatResult=await chatFlow.handle(actor,auth,req,route);if(chatResult)return send(chatResult.status,chatResult.data);
      if(route==='/api/local/ai/capabilities'&&req.method==='GET')return send(200,{available:false,reason:'legacy-disabled',mode:'synthetic-development',writesPerformed:false});
      if(route==='/api/local/ai'&&req.method==='POST'){deny(503,'Rota antiga de IA desativada. Use o chat autorizado.');}
      if(route==='/api/local/session'&&req.method==='GET')return send(200,{user:await userDTO(actor)});
      if(route==='/api/local/logout'&&req.method==='POST'){
        const body=await read(req);exact(body,[]);chatFlow.clearAuth(auth.hash);trainingProposal.clearAuth(auth.hash);await store.transaction(async()=>{await store.run('DELETE FROM sessions WHERE token_hash=?',auth.hash);await audit(actor,null,'logout');});res.setHeader('Set-Cookie',cookieHeader(security,'',0));return send(200,{loggedOut:true});
      }
      const nutritionResult=await nutrition.handle(actor,req,route);if(nutritionResult)return send(nutritionResult.status,nutritionResult.data);
      const executionResult=await execution.handle(actor,req,route);if(executionResult)return send(executionResult.status,executionResult.data);
      if(route==='/api/local/invitations'&&req.method==='POST'){const result=await invites.create(actor,req);return send(result.status,result.data);}
      if(route==='/api/local/professionals'&&req.method==='GET'){if(actor.role!=='admin')deny(403,'Equipe restrita ao administrador.');return send(200,{professionals:await store.all("SELECT id,name,role FROM users WHERE org_id=? AND active=1 AND role IN ('coach','nutrition') ORDER BY name",actor.org_id)});}
      if(route==='/api/local/students'&&req.method==='GET')return send(200,{students:(await list(actor)).map(row=>studentDTO(row,actor))});
      if(route==='/api/local/students'&&req.method==='POST'){
        const body=await read(req);const work=studentWork(actor,body);if(Object.hasOwn(body,'accessLevel'))await passwordAccess.throttleRegistration(actor);const result=await mutation(actor,req,body,work);return send(result.status,result.data);
      }
      if(route==='/api/local/onboarding'&&req.method==='PUT'){
        if(actor.role!=='student')deny(403,'Onboarding pertence ao aluno.');const row=await store.get('SELECT * FROM students WHERE user_id=? AND org_id=?',actor.id,actor.org_id);if(!row)deny(404,'Vínculo de aluno pendente.');
        const result=await saveOnboarding(actor,req,row,await read(req),'onboarding.saved');return send(result.status,result.data);
      }
      const studentMatch=/^\/api\/local\/students\/([a-f0-9-]{36})(\/plans|\/onboarding|\/assignments)?$/.exec(route);
      if(studentMatch){const row=await student(actor,studentMatch[1]);
        if(!studentMatch[2]&&req.method==='GET')return send(200,{student:studentDTO(row,actor)});
        if(studentMatch[2]==='/assignments'&&req.method==='PUT'){
          if(actor.role!=='admin')deny(403,'Atribuição exige administrador da organização.');
          const body=await read(req);exact(body,['coachId','nutritionId','revision']);
          for(const id of [body.coachId,body.nutritionId])if(id!==null&&(typeof id!=='string'||! /^[a-f0-9-]{36}$/.test(id)))deny(400,'Profissional inválido.');
          if(!Number.isInteger(body.revision)||body.revision<1)deny(400,'Revisão inválida.');
          const result=await mutation(actor,req,body,async()=>{
            await store.lockStudent(row.id);const current=await student(actor,row.id);
            if(current.revision!==body.revision)deny(409,'Dados mudaram. Recarregue antes de atribuir.');
            for(const [id,role] of [[body.coachId,'coach'],[body.nutritionId,'nutrition']])if(id!==null&&!await store.get('SELECT id FROM users WHERE id=? AND org_id=? AND role=? AND active=1',id,actor.org_id,role))deny(400,'Profissional ativo da mesma organização obrigatório.');
            const coach=body.coachId||actor.id,nutrition=body.nutritionId;
            const coachChanged=current.coach_id!==coach,nutritionChanged=current.nutrition_id!==nutrition;
            if(!coachChanged&&!nutritionChanged)return {status:200,data:{student:studentDTO(current,actor),changed:false}};
            const updated=await store.run('UPDATE students SET coach_id=?,nutrition_id=?,revision=revision+1 WHERE id=? AND org_id=? AND revision=?',coach,nutrition,row.id,actor.org_id,body.revision);
            if(updated.changes!==1)deny(409,'Dados mudaram. Recarregue antes de atribuir.');
            if(coachChanged){await store.run("UPDATE plans SET status='draft',approved_by=NULL,approved_revision=NULL,revision=revision+1 WHERE student_id=? AND status<>'published'",row.id);await audit(actor,row.id,'assignment.coach.changed:'+current.coach_id+'>'+coach);}
            if(nutritionChanged){await store.run("UPDATE nutrition_plans SET status='draft',approved_by=NULL,approved_revision=NULL,revision=revision+1 WHERE student_id=? AND status<>'published'",row.id);await audit(actor,row.id,'assignment.nutrition.changed:'+(current.nutrition_id||'none')+'>'+(nutrition||'none'));}
            return {status:200,data:{student:studentDTO(await student(actor,row.id),actor),changed:true}};
          });return send(result.status,result.data);
        }
        if(studentMatch[2]==='/onboarding'&&req.method==='PUT'){trainingManager(actor,row);const result=await saveOnboarding(actor,req,row,await read(req),'onboarding.recorded');return send(result.status,result.data);}
        if(studentMatch[2]==='/plans'&&req.method==='GET'){const plans=await store.all('SELECT * FROM plans WHERE student_id=?'+(actor.role==='student'?" AND status='published'":'')+' ORDER BY published_at DESC,id DESC',row.id);return send(200,{plans:plans.map(publicPlan)});}
        if(studentMatch[2]==='/plans'&&req.method==='POST'){
          const body=await read(req);const result=await mutation(actor,req,body,await planWork(actor,row.id,body));return send(result.status,result.data);
        }
      }
      const planMatch=/^\/api\/local\/plans\/([a-f0-9-]{36})\/(submit|approve|publish)$/.exec(route);
      if(planMatch&&req.method==='POST'){
        const plan=await store.get('SELECT * FROM plans WHERE id=?',planMatch[1]);if(!plan)deny(404,'Plano não encontrado.');const row=await student(actor,plan.student_id);trainingManager(actor,row);const body=await read(req);exact(body,['revision']);
        const result=await mutation(actor,req,body,async()=>{await store.lockStudent(row.id);trainingManager(actor,await student(actor,row.id));const current=await store.get('SELECT * FROM plans WHERE id=?',plan.id);if(body.revision!==current.revision)deny(409,'Plano mudou. Recarregue.');
          const action=planMatch[2];if(['approve','publish'].includes(action)){await trainingSafetyFlow.assertPublishable(actor,await student(actor,row.id));await trainingProposal.assertPlanApproval(actor,current);}
          const required={submit:'draft',approve:'review',publish:'approved'}[action];if(current.status!==required)deny(409,'Revisão profissional obrigatória antes de publicar.');
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
  handle.flushAccessEmail=()=>passwordAccess.flush();handle.close=async()=>{chatFlow.close();trainingProposal.close();await passwordAccess.close();};return handle;
}
