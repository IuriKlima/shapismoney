import {createInterface} from 'node:readline/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openLocalStore} from './store.mjs';
import {asyncLocalStore} from './async-store.mjs';
import {provisionInitialAdmin} from './bootstrap.mjs';
import {hiddenInput} from './hidden-input.mjs';

// Operator-only, interactive, new sandbox installation. Never run automatically.
export async function bootstrapAsaasSandbox({env=process.env,input=process.stdin,output=process.stdout}={}){
 if(process.env.NODE_ENV==='production'||env.SIM_ASAAS_ISOLATED_DATABASE!=='true'||!path.isAbsolute(env.SIM_ASAAS_DATABASE_PATH||'')||!input.isTTY||!output.isTTY)throw Error('Interactive isolated sandbox setup required.');
 if(['ADMIN_PASSWORD','BOOTSTRAP_PASSWORD','SIM_BOOTSTRAP_PASSWORD'].some(k=>env[k]!==undefined))throw Error('Do not supply account passwords in environment.');
 let reader,store,password='',repeat='';
 try{store=asyncLocalStore(openLocalStore(env.SIM_ASAAS_DATABASE_PATH));if(await store.get('SELECT id FROM users LIMIT 1'))throw Error('Initial setup requires an empty database.');
  reader=createInterface({input,output});const organizationName=await reader.question('Sandbox organization: '),name=await reader.question('Test administrator name: '),email=await reader.question('Test administrator email: '),confirmation=await reader.question('Type CRIAR ADMINISTRADOR INICIAL to create the sandbox administrator: ');reader.close();reader=null;
  if(confirmation!=='CRIAR ADMINISTRADOR INICIAL')throw Error('Setup not confirmed.');
  password=await hiddenInput('Sandbox password (hidden): ',{input,output});repeat=await hiddenInput('Repeat password (hidden): ',{input,output});if(password!==repeat)throw Error('Passwords differ.');
  const created=await provisionInitialAdmin({store,email,name,organizationName,password,confirmation});output.write('Sandbox administrator created. Organization ID: '+created.organizationId+'\n');
 }finally{password='';repeat='';reader?.close();await store?.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await bootstrapAsaasSandbox();}catch{console.error('Sandbox initial setup refused. Check empty isolated database and interactive terminal.');process.exitCode=1;}
}
