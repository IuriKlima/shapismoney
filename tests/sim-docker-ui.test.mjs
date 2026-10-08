import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('production image includes every direct persistent UI module',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const source=read('public/sim/persistent.js'),docker=read('deploy/Dockerfile'),ignore=read('deploy/Dockerfile.dockerignore');
  const imports=[...source.matchAll(/from '\.\/([^']+\.js)'/g)].map(match=>'public/sim/'+match[1]);
  assert.ok(imports.length>0);
  const copies=docker.split(/\r?\n/).filter(line=>line.startsWith('COPY ')&&line.endsWith('./public/sim/')).join(' ');
  for(const path of imports){assert.ok(copies.split(/\s+/).includes(path),'Docker COPY missing '+path);assert.ok(ignore.split(/\r?\n/).includes('!'+path),'build context excludes '+path);}
});
