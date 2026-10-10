import {validatePrivateMethod} from './proposal-methods.mjs';
import {readPrivateReferences} from './private-retrieval.mjs';
import {resolveAIConfiguration} from './ai-config.mjs';
import {responsesProposalAdapter} from './proposal-responses.mjs';
import {readPrivateTrainingMethod} from './training-proposals.mjs';

// Training opt-in is independent of chat. No key/method reads when disabled.
// Production activation remains outside this implementation slice.
export function trainingRuntimeConfiguration(env,security,{workspace=process.cwd(),readMethod=readPrivateTrainingMethod,readReferences=readPrivateReferences,resolveKey=resolveAIConfiguration}={}){
 if(env.SIM_TRAINING_EXTERNAL_ENABLED!=='true')return {};
 if(security.production)throw Error('External training production gate closed');
 const number=name=>{const value=Number(env[name]);if(!Number.isFinite(value)||value<=0)throw Error('Training configuration unavailable');return value;};
 const model=env.SIM_TRAINING_MODEL;if(typeof model!=='string'||!/^[a-zA-Z0-9._-]{1,100}$/.test(model))throw Error('Training model required');
 const expiresAt=number('SIM_TRAINING_EXPIRES_AT');if(!Number.isSafeInteger(expiresAt)||expiresAt<=Date.now()||expiresAt-Date.now()>86400000)throw Error('Training activation window unavailable');
 const budget={purpose:'training-proposals',budgetMode:'monthly-per-student',globalMonthlyUSD:number('SIM_TRAINING_GLOBAL_MONTHLY_USD'),adminMonthlyUSD:number('SIM_TRAINING_ADMIN_MONTHLY_USD'),inputRate:number('SIM_TRAINING_INPUT_RATE'),outputRate:number('SIM_TRAINING_OUTPUT_RATE')};
 if(budget.adminMonthlyUSD>budget.globalMonthlyUSD)throw Error('Training budget unavailable');
 const methodology=readMethod(env.SIM_TRAINING_METHOD_FILE,workspace);
 validatePrivateMethod(methodology);if(methodology.kind!=='training'||methodology.status!=='reviewed'||methodology.fixtureOnly===true||methodology.review?.providerTransferApproved!==true||methodology.rules.some(r=>r.providerTransferApproved!==true))throw Error('Reviewed transferable training method required');
 const privateReferences=env.SIM_TRAINING_REFERENCES_ENABLED==='true'?readReferences(env.SIM_TRAINING_REFERENCES_FILE,workspace):undefined;
 const ai=resolveKey({...env,SIM_AI_ENABLED:'true',OPENAI_MODEL:model});
 return {enabled:true,externalGate:true,mode:'external-reviewed',requireSessions:true,expiresAt,methodology,budget,...(privateReferences?{privateReferences}:{}),provider:responsesProposalAdapter({apiKey:ai.apiKey,model})};
}
