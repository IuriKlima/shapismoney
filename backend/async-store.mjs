import {AsyncLocalStorage} from 'node:async_hooks';
export function asyncLocalStore(raw){
  const context=new AsyncLocalStorage();let queue=Promise.resolve();
  const serialize=work=>{if(context.getStore())return Promise.resolve().then(work);const result=queue.then(work);queue=result.catch(()=>undefined);return result;};
  return {kind:'sqlite',get:(...args)=>serialize(()=>raw.get(...args)),all:(...args)=>serialize(()=>raw.all(...args)),run:(...args)=>serialize(()=>raw.run(...args)),lockActor:async()=>{},lockAIBudget:async()=>{},lockStudent:async()=>{},lockWorkout:async()=>{},
    transaction:work=>serialize(()=>context.run(true,async()=>{raw.exec('BEGIN IMMEDIATE');try{const result=await work();raw.exec('COMMIT');return result;}catch(error){raw.exec('ROLLBACK');throw error;}})),
    close:()=>serialize(()=>raw.close())};
}
