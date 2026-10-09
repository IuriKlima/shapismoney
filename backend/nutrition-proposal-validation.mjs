import {nutritionProposalSchemaFor,validateSchema} from './proposal-responses.mjs';
import {validateNutritionContent,NUTRIENT_KEYS} from './nutrition-validation.mjs';
import {nutritionTotals} from './nutrition.mjs';
export function nutritionProviderInput(c){
 const facts=Object.fromEntries(['targets','tolerances','allergies','preferences','meals'].map(k=>[k,c.context[k]]));
 return {kind:'nutrition',untrustedFacts:facts,untrustedMethod:{kind:'nutrition-reviewed-context',version:c.context.version,rules:c.context.rules,sources:c.context.sources,foods:c.catalog.map(r=>({id:r.id,name:r.name,status:r.status,preparation:r.preparation,per100g:Object.fromEntries(Object.entries(JSON.parse(r.composition)).map(([k,v])=>[k,v/100])),allergens:JSON.parse(r.allergens),mayContain:JSON.parse(r.may_contain)}))}};
}
export async function validateNutritionProposal(payload,c,{deny,exact,text}){
 validateSchema(payload,nutritionProposalSchemaFor(nutritionProviderInput(c)));
 if(new Set(payload.evidence).size!==payload.evidence.length)deny(400,'Evidências precisam de chaves únicas.');
 const ctx=c.context,rule=ctx.rules.find(r=>r.id===payload.ruleId);
 const body={title:payload.title,allergies:ctx.allergies,allergiesChecked:true,meals:payload.meals};
 const content=await validateNutritionContent({body,getFood:async id=>c.catalog.find(f=>f.id===id&&!ctx.preferences.excludedFoodIds.includes(id)),deny,exact,text,requirePreparation:true});
 assertNutritionContextContent(content,ctx,deny);
 return {...content,professionalContext:{revision:ctx.revision,version:ctx.version,targets:ctx.targets,tolerances:ctx.tolerances},generationReason:text(payload.reason,8,500),evidence:payload.evidence,ruleReference:{id:rule.id,section:rule.section,source:ctx.sources.find(s=>s.id===rule.sourceId)}};
}
export function assertNutritionContextContent(content,context,deny){
 if(JSON.stringify(content.allergies)!==JSON.stringify(context.allergies)||content.allergiesChecked!==true||content.meals.length!==context.meals.length)deny(409,'Alergias ou estrutura não correspondem ao contexto aprovado.');
 content.meals.forEach((meal,mi)=>{if(meal.name!==context.meals[mi].name||meal.items.length!==context.meals[mi].itemCount)deny(400,'Siga a estrutura de refeições aprovada.');for(const item of meal.items)for(const p of [item,...item.alternatives])if(!context.catalogIds.includes(p.foodId)||context.preferences.excludedFoodIds.includes(p.foodId))deny(400,'Alimento fora do contexto profissional.');});
 const totals=nutritionTotals(content.meals);
 for(const k of NUTRIENT_KEYS){
  const choicesLow=[],choicesHigh=[];
  content.meals.forEach((m,mi)=>m.items.forEach((i,ii)=>{const values=[i,...i.alternatives].map(p=>p.composition[k]*p.gramsTenths);choicesLow.push({mealIndex:mi,itemIndex:ii,optionIndex:values.indexOf(Math.min(...values))});choicesHigh.push({mealIndex:mi,itemIndex:ii,optionIndex:values.indexOf(Math.max(...values))});}));
  const low=nutritionTotals(content.meals,choicesLow)[k],high=nutritionTotals(content.meals,choicesHigh)[k],target=context.targets[k],tolerance=context.tolerances[k];
  // Bounds cover every permitted combination without enumerating combinations.
  if(Math.abs(totals[k]-target)>tolerance+1e-7||low<target-tolerance-1e-7||high>target+tolerance+1e-7)deny(400,'Porções e todas as combinações de alternativas precisam respeitar as tolerâncias profissionais.');
 }
 return {totals,targets:context.targets,deviations:Object.fromEntries(NUTRIENT_KEYS.map(k=>[k,Math.round((totals[k]-context.targets[k])*1000)/1000]))};
}
