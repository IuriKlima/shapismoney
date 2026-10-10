import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ignore from 'ignore';
import {execFileSync} from 'node:child_process';

test('build context permits runtime sources and optimized brand asset but excludes private/test sentinels',()=>{
  const patterns=fs.readFileSync(new URL('../deploy/Dockerfile.dockerignore',import.meta.url),'utf8');
  // These patterns deliberately use the shared gitignore/Docker subset; actual Docker is a separate release gate.
  const excluded=ignore().add(patterns);
  const tracked=execFileSync('git',['ls-files'],{encoding:'utf8'}).trim().split(/\r?\n/);
  for(const file of tracked.filter(f=>/^backend\/(?:[^/]+\.mjs|package(?:-lock)?\.json|(?:pg-)?migrations\/[^/]+\.sql)$/.test(f)))assert.equal(excluded.ignores(file),false,file);
  for(const file of ['public/sim/assets/architecture.webp','public/sim/assets/bruno-barbosa-667.webp','public/sim/assets/bruno-barbosa-400.webp','public/sim/public.js','public/sim/profile-ui.js'])assert.equal(excluded.ignores(file),false,file);
  for(const file of ['backend/.env.local','backend/.npmrc','backend/app.sqlite-wal','backend/schema.dump','backend/private.pem','backend/fixtures/student.json','backend/backup/data.backup','backend/secrets/password','backend/node_modules/lib/index.js','public/sim/assets/.env','public/sim/assets/student.sqlite','public/sim/assets/private.pem','public/sim/assets/original-portrait.png','public/sim/assets/fixtures/student.json','.qa/server.log','tests/backend-fixtures.mjs','.git/config'])assert.equal(excluded.ignores(file),true,file);
});
