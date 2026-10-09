import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisFixture as fixture} from './analysis-demo-fixtures.mjs';
import {DEMO_VIDEO_IDS} from '../backend/analysis-demo-data.mjs';
import {nutritionAnalysisAdapter,validateDemoNutrition} from '../backend/analysis-demo-nutrition.mjs';
import {createAnalysisDemo} from '../backend/analysis-demo.mjs';

test('isolated opt-in HTTP demo: synthetic intake → validated mock draft → preserved human version → student video → deterministic meals/options',async()=>{
 const f=await fixture();try{let s=(await f.req()).data;assert.equal(s.syntheticOnly,true);assert.equal(s.mediaAvailable,true);assert.equal(s.catalog.length,3);assert.equal(s.providers.externalCalls,0);
 s=(await f.req('/training/generate',{revision:s.revision})).data;assert.equal(s.training.state,'draft');assert.equal(s.training.content.sessions.length,3);assert.equal(s.training.clinicalApproval,false);const original=structuredClone(s.training);const changed=structuredClone(s.training.payload);changed.title='Explicit fictional human revision';changed.sessions[0].exercises[0].sets=3;
 s=(await f.req('/training/edit',{revision:s.revision,payload:changed},'PUT')).data;assert.equal(s.history.training.length,2);assert.deepEqual(s.history.training[0],original);assert.equal(s.training.origin,'human-demo-edit');assert.equal(s.published,false);
 const v=s.catalog[0],response=await fetch(f.origin+v.url,{headers:{Range:'bytes=0-7'}});assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,8);assert.equal(v.associationStatus,'pending-bruno-validation');
 const e=s.training.content.sessions[0].exercises[0];s=(await f.req('/training/execution',{revision:s.revision,sessionId:s.training.content.sessions[0].id,exerciseId:e.exerciseId,completedSets:1},'PUT')).data;assert.equal(Object.values(s.execution)[0],1);
 s=(await f.req('/nutrition/generate',{revision:s.revision})).data;assert.equal(s.nutrition.state,'draft');assert.equal(s.nutritionView.totals.energyKcal,550);assert.equal(s.nutritionView.totals.proteinG,25);assert.equal(s.nutritionView.targets.syntheticOnly,true);const before=s.nutritionView.totals;
 s=(await f.req('/nutrition/choices',{revision:s.revision,choices:[{mealIndex:0,itemIndex:0,optionIndex:1}]},'PUT')).data;assert.equal(s.nutritionView.totals.energyKcal,550);assert.notEqual(s.nutritionView.totals.proteinG,before.proteinG);
 const prior=s.nutrition,meal=structuredClone(prior.payload);meal.meals[0].items[0].grams=100;s=(await f.req('/nutrition/edit',{revision:s.revision,payload:meal},'PUT')).data;assert.equal(s.history.nutrition.length,2);assert.deepEqual(s.history.nutrition[0],prior);assert.equal(s.nutritionView.totals.energyKcal,500);
 assert.equal(f.app.store.get('SELECT COUNT(*) AS n FROM plans').n,0);assert.equal(f.app.store.get('SELECT COUNT(*) AS n FROM nutrition_plans').n,0);assert.equal(f.app.store.get('SELECT COUNT(*) AS n FROM users').n,0);assert.equal(f.app.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,0);
 }finally{await f.close();}
});

test('default off, production off, no credential/network and no alternate video lookup',async()=>{
 const f=await fixture(false);try{assert.equal((await f.req()).status,404);assert.equal((await fetch(f.origin+'/analysis-demo')).status,404);assert.equal((await fetch(f.origin+'/sim/analysis-demo.js')).status,404);assert.equal((await fetch(f.origin+'/sim/analysis-demo.css')).status,404);}finally{await f.close();}
 assert.equal(createAnalysisDemo({enabled:true,security:{production:true}}).enabled,false);const adapter=nutritionAnalysisAdapter({apiKey:'fictitious',model:'fictitious',fetchImpl:async()=>assert.fail('No network')});await assert.rejects(()=>adapter.generate({}),/gate closed/);
 const missing=await fixture();try{assert.equal((await fetch(missing.origin+'/api/demo/analysis/videos/00000000-0000-0000-0000-000000000000')).status,404);assert.equal((await fetch(missing.origin+'/api/demo/analysis/videos/'+DEMO_VIDEO_IDS[0],{headers:{Range:'bytes=99-100'}})).status,416);}finally{await missing.close();}
});

test('strict fixture boundary, stale edits, invalid IDs/allergies/portions and changed intake cannot produce clinical plans',async()=>{
 const f=await fixture();try{let s=(await f.req()).data;assert.equal((await f.req('/training/generate',{revision:s.revision,studentId:'real-student'})).status,400);s=(await f.req('/training/generate',{revision:s.revision})).data;
 const p=structuredClone(s.training.payload);p.sessions[0].exercises[0].exerciseId='invented';assert.equal((await f.req('/training/edit',{revision:s.revision,payload:p},'PUT')).status,400);assert.equal((await f.req('/training/generate',{revision:s.revision-1})).status,409);
 s=(await f.req('/nutrition/generate',{revision:s.revision})).data;const bad=structuredClone(s.nutrition.payload);bad.meals[0].items[0].grams=.123;assert.equal((await f.req('/nutrition/edit',{revision:s.revision,payload:bad},'PUT')).status,400);bad.meals[0].items[0].grams=100;bad.meals[0].items[0].foodId='invented';assert.equal((await f.req('/nutrition/edit',{revision:s.revision,payload:bad},'PUT')).status,400);assert.equal((await f.req('/nutrition/choices',{revision:s.revision,choices:[{mealIndex:0,itemIndex:0,optionIndex:4}]},'PUT')).status,400);
 const allergy=structuredClone(s.nutrition.payload);allergy.meals[0].items[0]={foodId:'fixture-food-c',preparation:'as-sold',grams:100,alternatives:[]};assert.throws(()=>validateDemoNutrition(allergy,{...s.facts,allergies:['milk']}));
 s=(await f.req('/intake',{revision:s.revision,days:2},'PUT')).data;assert.equal(s.training,null);assert.equal(s.nutrition,null);assert.equal(s.originalIntake.days,3);assert.equal(s.facts.days,2);assert.equal(s.history.training.length,1);assert.equal(s.history.nutrition.length,1);
 }finally{await f.close();}
});
