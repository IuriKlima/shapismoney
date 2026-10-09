// Shared manual/generated validator; catalog integers are authoritative.
export const NUTRIENT_KEYS=Object.freeze(['energyKcal','proteinG','carbsG','fatG']);
const aliases={leite:'milk',lacteos:'milk',lácteos:'milk',ovo:'egg',ovos:'egg',soja:'soy',trigo:'wheat',amendoim:'peanut',peixe:'fish',crustaceos:'shellfish','crustáceos':'shellfish'};
export function normalizeAllergens(values,deny){
 if(!Array.isArray(values)||values.length>30)deny(400,'Declare alergênicos válidos.');
 const normalized=values.map(v=>{if(typeof v!=='string')deny(400,'Alergênico inválido.');const code=v.trim().toLowerCase();return aliases[code]||code;});
 if(normalized.some(v=>v.length<2||v.length>60||!/^[a-z0-9-]+$/.test(v))||new Set(normalized).size!==normalized.length)deny(400,'Alergênicos precisam de códigos únicos, inclusive equivalências leite/milk.');
 return normalized;
}
export function nutritionScaled(v,max,scale,deny){if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>max||Math.abs(v*scale-Math.round(v*scale))>1e-7)deny(400,'Valor ou precisão inválidos. Use gramas e valores por 100 g.');return Math.round(v*scale);}
export async function validateNutritionContent({body,getFood,deny,exact,text,requirePreparation=false}){
 exact(body,['title','allergies','allergiesChecked','meals']);
 text(body.title,2,100);if(body.allergiesChecked!==true)deny(400,'Confira alergias, traços e adequação das opções.');
 const allergies=normalizeAllergens(body.allergies,deny);
 if(!Array.isArray(body.meals)||body.meals.length<1||body.meals.length>6)deny(400,'Use 1-6 refeições.');let portions=0;
 async function portion(input){
  exact(input,['foodId','grams',...(requirePreparation?['preparation']:[])]);
  if(typeof input.foodId!=='string'||!/^[a-f0-9-]{36}$/.test(input.foodId))deny(400,'Alimento inválido.');
  const gramsTenths=nutritionScaled(input.grams,2000,10,deny);if(gramsTenths<1)deny(400,'Porção deve ser positiva.');
  const row=await getFood(input.foodId);if(!row||row.status!=='approved')deny(400,'Use alimento aprovado da organização.');
  if(requirePreparation&&input.preparation!==row.preparation)deny(400,'Estado do alimento precisa coincidir com o catálogo.');
  const allergens=normalizeAllergens(JSON.parse(row.allergens),deny),mayContain=normalizeAllergens(JSON.parse(row.may_contain),deny);
  if([...allergens,...mayContain].some(a=>allergies.includes(a)))deny(400,'Alimento ou alternativa conflita com alergia declarada.');
  const composition=JSON.parse(row.composition);
  if(Object.keys(composition).sort().join()!==NUTRIENT_KEYS.slice().sort().join()||NUTRIENT_KEYS.some(k=>!Number.isSafeInteger(composition[k])||composition[k]<0||composition[k]>(k==='energyKcal'?100000:10000))||composition.proteinG+composition.carbsG+composition.fatG>10000)deny(409,'Composição aprovada inconsistente.');
  return {foodId:row.id,name:row.name,preparation:row.preparation,gramsTenths,composition,allergens,mayContain,provenance:JSON.parse(row.provenance),catalogRevision:row.revision,approvedBy:row.approved_by};
 }
 const meals=[];
 for(const meal of body.meals){
  exact(meal,['name','items']);if(!Array.isArray(meal.items)||meal.items.length<1||meal.items.length>6)deny(400,'Use 1-6 itens por refeição.');
  const items=[];
  for(const item of meal.items){
   exact(item,['foodId','grams','alternatives',...(requirePreparation?['preparation']:[])]);
   if(!Array.isArray(item.alternatives)||item.alternatives.length>4)deny(400,'Use até quatro alternativas.');
   portions+=1+item.alternatives.length;if(portions>60)deny(400,'Limite de 60 porções/opções.');
   const {alternatives:raw,...primaryInput}=item,primary=await portion(primaryInput),alternatives=[],seen=new Set([primary.foodId]);
   for(const input of raw){if(seen.has(input.foodId))deny(400,'Alternativas não podem repetir o item ou outra opção.');seen.add(input.foodId);alternatives.push(await portion(input));}
   items.push({...primary,alternatives});
  }
  meals.push({name:text(meal.name,2,80),items});
 }
 return {allergies,allergiesChecked:true,meals};
}
export function editableNutrition(content,title){const portion=p=>({foodId:p.foodId,grams:p.gramsTenths/10});return {title,allergies:content.allergies,allergiesChecked:true,meals:content.meals.map(m=>({name:m.name,items:m.items.map(i=>({...portion(i),alternatives:i.alternatives.map(portion)}))}))};}
