import {readPrivateReferences} from './private-retrieval.mjs';
import {resolveAIConfiguration} from './ai-config.mjs';
import {responsesProposalAdapter} from './proposal-responses.mjs';
// Independent explicit opt-in. No key resolution or network when disabled.
// Reviewed per-student nutrition context/credential/consent are checked in the durable flow.
export function nutritionRuntimeConfiguration(env,security,{workspace=process.cwd(),readReferences=readPrivateReferences,resolveKey=resolveAIConfiguration}={}){
 if(env.SIM_NUTRITION_EXTERNAL_ENABLED!=='true')return {};
 if(security.production)throw Error('Nutrition production activation requires a separate review; gate closed');
 const number=name=>{const n=Number(env[name]);if(!Number.isFinite(n)||n<=0)throw Error('Nutrition configuration unavailable');return n;};
 const model=env.SIM_NUTRITION_MODEL;if(typeof model!=='string'||!/^[a-zA-Z0-9._-]{1,100}$/.test(model))throw Error('Nutrition model required');
 const expiresAt=number('SIM_NUTRITION_EXPIRES_AT');if(!Number.isSafeInteger(expiresAt)||expiresAt<=Date.now()||expiresAt-Date.now()>86400000)throw Error('Nutrition activation window unavailable');
 const budget={purpose:'nutrition-proposals',budgetMode:'monthly-per-student',globalMonthlyUSD:number('SIM_NUTRITION_GLOBAL_MONTHLY_USD'),adminMonthlyUSD:number('SIM_NUTRITION_ADMIN_MONTHLY_USD'),inputRate:number('SIM_NUTRITION_INPUT_RATE'),outputRate:number('SIM_NUTRITION_OUTPUT_RATE')};
 if(budget.adminMonthlyUSD>budget.globalMonthlyUSD)throw Error('Nutrition budget unavailable');
 const privateReferences=env.SIM_NUTRITION_REFERENCES_ENABLED==='true'?readReferences(env.SIM_NUTRITION_REFERENCES_FILE,workspace):undefined;
 const ai=resolveKey({...env,SIM_AI_ENABLED:'true',OPENAI_MODEL:model});
 return {enabled:true,externalGate:true,mode:'external-reviewed',expiresAt,budget,...(privateReferences?{privateReferences}:{}),provider:responsesProposalAdapter({apiKey:ai.apiKey,model})};
}
