import {createInterface} from 'node:readline/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {productionSecurity} from './security.mjs';
import {postgresStore,poolFromEnvironment,verifyRuntimeRole} from './postgres.mjs';
import {provisionInitialAdmin,BootstrapFailure} from './bootstrap.mjs';
import {hiddenInput} from './hidden-input.mjs';
export async function runBootstrap({argv=process.argv,env=process.env,input=process.stdin,output=process.stdout}={}){
  if(argv.length!==2||!input.isTTY||!output.isTTY)throw new BootstrapFailure('Bootstrap aceita somente terminal interativo, sem argumentos.');
  if(['ADMIN_PASSWORD','BOOTSTRAP_PASSWORD','SIM_BOOTSTRAP_PASSWORD'].some(key=>env[key]!==undefined))throw new BootstrapFailure('Não forneça senha de usuário por ambiente.');
  productionSecurity(env);let store,reader,password='',repeat='';
  try{
    store=postgresStore(poolFromEnvironment(env));await verifyRuntimeRole(store);
    if(await store.get("SELECT id FROM users WHERE role='admin' LIMIT 1"))throw new BootstrapFailure('Já existe administrador. Bootstrap inicial recusado.');
    reader=createInterface({input,output});
    output.write('Bootstrap manual de instalação vazia. Não cria personal/nutri/aluno, não redefine senha e não altera administrador existente.\n');
    const organizationName=await reader.question('Nome da organização: '),name=await reader.question('Nome do administrador: '),email=await reader.question('E-mail do administrador: ');
    const confirmation=await reader.question('Para autorizar esta criação, digite CRIAR ADMINISTRADOR INICIAL: ');reader.close();reader=null;
    if(confirmation!=='CRIAR ADMINISTRADOR INICIAL')throw new BootstrapFailure('Criação não confirmada.');
    password=await hiddenInput('Senha (14–128 caracteres, sem eco): ',{input,output});repeat=await hiddenInput('Repita a senha (sem eco): ',{input,output});
    if(password!==repeat)throw new BootstrapFailure('As senhas não coincidem. Nenhuma conta criada.');
    await provisionInitialAdmin({store,email,name,organizationName,password,confirmation});output.write('Administrador inicial criado e auditado. Nenhuma senha ou token foi exibido.\n');
  }finally{password='';repeat='';reader?.close();await store?.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await runBootstrap();}catch(error){console.error(error instanceof BootstrapFailure?error.message:'Bootstrap não concluído. Verifique ambiente, banco e terminal seguro; nenhuma alteração parcial foi confirmada.');process.exitCode=1;}
}
