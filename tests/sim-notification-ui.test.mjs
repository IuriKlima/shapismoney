import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {notificationUI} from '../public/sim/notification-ui.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('student sees published updates and explicitly marks read; reset/role change remove private state',async()=>{
 const dom=new JSDOM('<main></main>');let user={role:'student'};const calls=[];
 const ui=notificationUI({api:async(...args)=>{calls.push(args);return {notifications:[{id:'<script>',kind:'training',publishedAt:Date.parse('2026-11-10T12:00:00Z'),readAt:null,emailState:'disabled'}],emailAvailable:false};},esc,perform:async work=>work(),getUser:()=>user,getStudent:()=>({id:'own'})});
 try{await ui.load();const main=dom.window.document.querySelector('main');main.innerHTML=ui.render();assert.equal(calls[0][0],'notifications');assert.match(main.textContent,/Seu treino foi publicado/);assert.ok(!main.textContent.includes('e-mail desativado'));assert.equal(main.querySelector('script'),null);const button=main.querySelector('[data-notice-read]');assert.equal(ui.click({target:button,preventDefault(){}}),true);await Promise.resolve();assert.deepEqual(calls[1].slice(0,3),['notifications/<script>/read',{confirmed:true},'POST']);user={role:'coach'};assert.equal(ui.render(),'');await ui.load();assert.equal(calls.length,2);user={role:'student'};ui.reset();assert.equal(ui.render(),'');}finally{dom.window.close();}
});
test('admin notice status distinguishes provider acceptance, disabled delivery and uncertain delivery',async()=>{
 const ui=notificationUI({api:async path=>{assert.equal(path,'students/own/notifications');return {notifications:[{id:'n',kind:'nutrition',publishedAt:1,readAt:null,emailState:'accepted'},{id:'n2',kind:'training',publishedAt:1,readAt:2,emailState:'delivery-unknown'}],emailAvailable:false};},esc,perform:async f=>f(),getUser:()=>({role:'admin'}),getStudent:()=>({id:'own'})});
 await ui.load();const html=ui.render();assert.match(html,/entrega na caixa não confirmada/);assert.match(html,/sem reenvio automático/);assert.match(html,/envio por e-mail está desativado/);assert.ok(!html.includes('data-notice-read'));
});
