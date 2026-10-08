import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Writable} from 'node:stream';
import {openLocalStore} from '../backend/store.mjs';
import {asyncLocalStore} from '../backend/async-store.mjs';
import {provisionInitialAdmin} from '../backend/bootstrap.mjs';
import {hiddenInput} from '../backend/hidden-input.mjs';
import {runBootstrap} from '../backend/bootstrap-admin.mjs';
import {verifyPassword} from '../backend/auth.mjs';
const data={email:'initial@bootstrap.example.test',name:'Administrador Fictício',organizationName:'Organização Fictícia',password:'Fictitious-bootstrap-only-2026!',confirmation:'CRIAR ADMINISTRADOR INICIAL'};
test('bootstrap inicial transacional, auditado, sem senha plaintext; recusa repetição concorrente',async()=>{
  const raw=openLocalStore(':memory:'),store=asyncLocalStore(raw);try{
    const attempts=await Promise.allSettled([provisionInitialAdmin({...data,store}),provisionInitialAdmin({...data,store})]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.match(attempts.find(r=>r.status==='rejected').reason.message,/Já existe administrador/);
    const user=raw.get('SELECT * FROM users');assert.equal(user.role,'admin');assert.equal(await verifyPassword(data.password,user.password_hash),true);assert.ok(!JSON.stringify(user).includes(data.password));assert.equal(raw.get('SELECT COUNT(*) AS n FROM organizations').n,1);assert.equal(raw.get("SELECT COUNT(*) AS n FROM audit WHERE event='bootstrap.admin.created'").n,1);assert.ok(!JSON.stringify(attempts.find(r=>r.status==='fulfilled').value).includes(data.password));
  }finally{await store.close();}
});
test('entrada inválida/confirmação ausente/instalação não vazia recusadas',async()=>{
  const raw=openLocalStore(':memory:'),store=asyncLocalStore(raw);try{
    for(const change of [{email:'invalid'},{name:''},{organizationName:''},{password:'short'},{password:'x'.repeat(129)},{confirmation:'yes'}])await assert.rejects(()=>provisionInitialAdmin({...data,...change,store}));assert.equal(raw.get('SELECT COUNT(*) AS n FROM users').n,0);
    raw.run('INSERT INTO organizations VALUES (?,?)','existing','Existente');await assert.rejects(()=>provisionInitialAdmin({...data,store}),/não está vazia/);assert.equal(raw.get('SELECT COUNT(*) AS n FROM users').n,0);
  }finally{await store.close();}
});
test('falha de auditoria reverte tudo e não retorna mensagem secreta do banco',async()=>{
  const raw=openLocalStore(':memory:'),store=asyncLocalStore(raw),failing={...store,run:async(sql,...args)=>{if(sql.startsWith('INSERT INTO audit'))throw Error(data.password);return store.run(sql,...args);}};
  try{await assert.rejects(()=>provisionInitialAdmin({...data,store:failing}),error=>!error.message.includes(data.password)&&/Nenhuma alteração parcial/.test(error.message));assert.equal(raw.get('SELECT COUNT(*) AS n FROM users').n,0);assert.equal(raw.get('SELECT COUNT(*) AS n FROM organizations').n,0);}finally{await store.close();}
});
function terminal(){const input=new PassThrough();input.isTTY=true;input.isRaw=false;input.setRawMode=value=>{input.isRaw=value;};let printed='';const output=new Writable({write(chunk,_encoding,callback){printed+=chunk.toString();callback();}});output.isTTY=true;return {input,output,text:()=>printed,close:()=>{input.destroy();output.destroy();}};}
test('senha no terminal sem eco, backspace e cancelamento restauram modo raw',async()=>{
  const t=terminal();try{const secret='fictitious-hidden-only!';const result=hiddenInput('Senha: ',t);for(const character of secret)t.input.emit('keypress',character,{});t.input.emit('keypress','x',{});t.input.emit('keypress','',{name:'backspace'});t.input.emit('keypress','\r',{name:'return'});assert.equal(await result,secret);assert.equal(t.text(),'Senha: \n');assert.equal(t.input.isRaw,false);
    const cancelled=hiddenInput('Senha: ',t);t.input.emit('keypress','private-fictitious',{});t.input.emit('keypress','',{ctrl:true,name:'c'});await assert.rejects(()=>cancelled,/cancelada/);assert.ok(!t.text().includes('private-fictitious'));assert.equal(t.input.isRaw,false);
  }finally{t.close();}
});
test('CLI recusa argumentos, senha por ambiente e entrada redirecionada antes de tocar DB',async()=>{
  const t=terminal();try{
    for(const options of [{argv:['node','bootstrap','fictitious-password-argument']},{argv:['node','bootstrap'],env:{BOOTSTRAP_PASSWORD:'fictitious-env-password'}},{argv:['node','bootstrap'],input:{isTTY:false}}])await assert.rejects(()=>runBootstrap({argv:['node','bootstrap'],env:{},input:t.input,output:t.output,...options}),error=>!error.message.includes('fictitious-'));
    assert.equal(t.text(),'');
  }finally{t.close();}
});
