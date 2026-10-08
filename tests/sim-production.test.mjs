import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {productionSecurity,assertRequest,cookieHeader} from '../backend/security.mjs';
import {poolFromEnvironment} from '../backend/postgres.mjs';
const env={SIM_PRODUCTION_REVIEWED:'true',SIM_PUBLIC_ORIGIN:'https://app.example.test',SIM_TRUSTED_PROXY_IPS:'172.20.0.2'};
test('produção exige HTTPS canônico/revisão/IP explícito e cookie seguro sem Domain',()=>{
  for(const change of [{SIM_PRODUCTION_REVIEWED:'false'},{SIM_PUBLIC_ORIGIN:'http://app.example.test'},{SIM_PUBLIC_ORIGIN:'https://app.example.test/path'},{SIM_PUBLIC_ORIGIN:'https://localhost'},{SIM_TRUSTED_PROXY_IPS:'172.20.0.0/16'},{SIM_TRUSTED_PROXY_IPS:''}])assert.throws(()=>productionSecurity({...env,...change}));
  const security=productionSecurity(env),cookie=cookieHeader(security,'test-only-token',3600);assert.match(cookie,/^__Host-sim_session=/);assert.match(cookie,/Secure/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.ok(!cookie.includes('Domain='));
});
test('proxy não confiável, HTTP encaminhado, Host/Origin externos e cadeia ambígua são negados',()=>{
  const security=productionSecurity(env),req={method:'POST',socket:{remoteAddress:'172.20.0.2'},headers:{host:'app.example.test',origin:'https://app.example.test','x-forwarded-proto':'https','x-forwarded-for':'203.0.113.10'}};assert.equal(assertRequest(req,security).clientIP,'203.0.113.10');
  for(const change of [{'x-forwarded-proto':'http'},{host:'external.test'},{origin:'https://external.test'},{'x-forwarded-for':'203.0.113.10, 172.20.0.3'},{'sec-fetch-site':'cross-site'}])assert.throws(()=>assertRequest({...req,headers:{...req.headers,...change}},security));assert.throws(()=>assertRequest({...req,socket:{remoteAddress:'172.20.0.9'}},security));
});
test('configuração DB rejeita papel privilegiado e TLS inseguro; somente rede privada explicitada',async()=>{
  const base={PGHOST:'shape-is-money-db',PGDATABASE:'sim_platform',PGUSER:'sim_app',PGPASSWORD:'test-only-not-a-production-secret',SIM_DB_TLS:'private-network'};
  for(const change of [{PGUSER:'postgres'},{PGPASSWORD:''},{PGHOST:'public.example.test'},{SIM_DB_TLS:'disable'}])assert.throws(()=>poolFromEnvironment({...base,...change}));const pool=poolFromEnvironment(base);await pool.end();
});
test('artefatos não embutem env/QA; DB sem porta publicada e runtime não recebe bootstrap',()=>{
  const docker=readFileSync(new URL('../deploy/Dockerfile',import.meta.url),'utf8'),compose=readFileSync(new URL('../deploy/compose.yaml',import.meta.url),'utf8').replaceAll('\r\n','\n');assert.match(docker,/USER node/);assert.match(docker,/HEALTHCHECK/);assert.ok(!/COPY\s+\.\s/.test(docker));assert.ok(!docker.includes('tests/'));assert.ok(!compose.includes('ports:'));const runtime=compose.slice(compose.indexOf('  shape-is-money:\n'),compose.indexOf('\nnetworks:'));assert.ok(!runtime.includes('db_bootstrap'));assert.match(runtime,/read_only: true/);assert.match(runtime,/SIM_AI_ENABLED: "false"/);
});

test('staging HTTPS restrito funciona antes de aprovação; produção continua bloqueada',()=>{
  const staging={...env,SIM_DEPLOYMENT_STAGE:'staging',SIM_PRODUCTION_REVIEWED:'false',SIM_STAGING_CLIENT_IPS:'203.0.113.10'};const security=productionSecurity(staging);assert.equal(security.stage,'staging');assert.match(cookieHeader(security,'fictitious',3600),/Secure/);
  const req={method:'POST',socket:{remoteAddress:'172.20.0.2'},headers:{host:'app.example.test',origin:'https://app.example.test','x-forwarded-proto':'https','x-forwarded-for':'203.0.113.10'}};assert.doesNotThrow(()=>assertRequest(req,security));assert.throws(()=>assertRequest({...req,headers:{...req.headers,'x-forwarded-for':'203.0.113.11'}},security),/homologação restrito/);
  for(const clients of ['', '203.0.113.0/24','*'])assert.throws(()=>productionSecurity({...staging,SIM_STAGING_CLIENT_IPS:clients}));assert.throws(()=>productionSecurity({...staging,SIM_DEPLOYMENT_STAGE:'production'}),/review flag/);assert.throws(()=>productionSecurity({...staging,SIM_PUBLIC_ORIGIN:'http://app.example.test'}));
});

test('custom upstream requires exact trusted peer, internal Host and canonical forwarded Host',()=>{
  const security=productionSecurity({...env,SIM_DEPLOYMENT_STAGE:'staging',SIM_PRODUCTION_REVIEWED:'false',SIM_STAGING_CLIENT_IPS:'203.0.113.10',SIM_PROXY_UPSTREAM_HOST:'tasks.medsi_shape-is-money:5190'});
  const req={method:'GET',socket:{remoteAddress:'::ffff:172.20.0.2'},headers:{host:'tasks.medsi_shape-is-money:5190','x-forwarded-host':'app.example.test','x-forwarded-proto':'https','x-forwarded-for':'203.0.113.10'}};
  assert.equal(assertRequest(req,security).clientIP,'203.0.113.10');
  for(const change of [{host:'other-internal:5190'},{'x-forwarded-host':'external.test'},{'x-forwarded-host':'app.example.test, external.test'},{'x-forwarded-host':undefined},{'x-forwarded-proto':'https, http'},{'x-forwarded-for':'203.0.113.11'},{'x-forwarded-for':'203.0.113.10, 172.20.0.2'}])assert.throws(()=>assertRequest({...req,headers:{...req.headers,...change}},security));
  assert.throws(()=>assertRequest({...req,socket:{remoteAddress:'172.20.0.4'}},security));
  assert.throws(()=>assertRequest(req,productionSecurity(env)));
  assert.throws(()=>assertRequest({...req,method:'POST',headers:{...req.headers,origin:'https://external.test'}},security));
  assert.equal(assertRequest({...req,method:'POST',headers:{...req.headers,origin:security.origin}},security).clientIP,'203.0.113.10');
  for(const value of ['*','tasks.medsi_shape-is-money:5190,other:5190','http://tasks.medsi_shape-is-money:5190'])assert.throws(()=>productionSecurity({...env,SIM_PROXY_UPSTREAM_HOST:value}));
});
