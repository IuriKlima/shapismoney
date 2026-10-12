import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sandboxConfiguration} from '../backend/commerce/asaas-sandbox-config.mjs';
const values={SIM_ASAAS_SANDBOX_ENABLED:'true',SIM_ASAAS_ENVIRONMENT:'sandbox',SIM_ASAAS_NETWORK_APPROVED:'true',ASAAS_SANDBOX_ACCOUNT_ID:'fixture',ASAAS_SANDBOX_API_KEY:'fixture-api-key-never-real-000000000',ASAAS_WEBHOOK_AUTH_TOKEN:'fixture-webhook-never-real-111111111',ASAAS_SANDBOX_PUBLIC_ORIGIN:'https://test.fixture.invalid'};
test('sandbox configuration is inert by default, explicit and never shares API/webhook secrets or production origin',()=>{
 assert.deepEqual(sandboxConfiguration(),{enabled:false});const config=sandboxConfiguration(values);assert.equal(config.periodPolicy,'first-authorized-protocol-release');assert.equal(config.automaticRenewal,false);
 for(const patch of [{SIM_ASAAS_ENVIRONMENT:'production'},{SIM_ASAAS_NETWORK_APPROVED:'false'},{ASAAS_WEBHOOK_AUTH_TOKEN:values.ASAAS_SANDBOX_API_KEY},{ASAAS_SANDBOX_PUBLIC_ORIGIN:'https://shapeismoney.com.br'},{ASAAS_SANDBOX_PUBLIC_ORIGIN:'http://test.fixture.invalid'},{ASAAS_SANDBOX_ACCOUNT_ID:null},{ASAAS_SANDBOX_API_KEY:'short'}])assert.throws(()=>sandboxConfiguration({...values,...patch}),e=>e.status===503&&!e.message.includes(values.ASAAS_SANDBOX_API_KEY));
 for(const file of ['backend/server.mjs','backend/bootstrap.mjs','backend/service.mjs'])assert.doesNotMatch(readFileSync(new URL('../'+file,import.meta.url),'utf8'),/asaas-sandbox-config|manual-renewal/);
});
