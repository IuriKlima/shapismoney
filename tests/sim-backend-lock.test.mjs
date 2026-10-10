import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import semver from 'semver';
test('backend lock resolves every required and optional dependency including foreign-platform Sharp WASM runtimes',()=>{
  const lock=JSON.parse(fs.readFileSync(new URL('../backend/package-lock.json',import.meta.url),'utf8'));
  const manifest=JSON.parse(fs.readFileSync(new URL('../backend/package.json',import.meta.url),'utf8'));
  assert.deepEqual(lock.packages[''].dependencies,manifest.dependencies);
  const resolve=(from,name)=>{let prefix=from;for(;;){const key=(prefix?prefix+'/':'')+'node_modules/'+name;if(lock.packages[key])return {key,...lock.packages[key]};if(!prefix)return null;const split=prefix.lastIndexOf('/');prefix=split<0?'':prefix.slice(0,split);}};
  for(const [from,entry] of Object.entries(lock.packages))for(const [name,range] of Object.entries({...entry.dependencies,...entry.optionalDependencies})){
    const resolved=resolve(from,name);assert.ok(resolved,from+' -> '+name+' is missing');
    assert.ok(semver.satisfies(resolved.version,range),from+' -> '+name+' '+resolved.version+' does not satisfy '+range);
  }
  for(const parent of ['@img/sharp-freebsd-wasm32','@img/sharp-webcontainers-wasm32']){
    const wasm=resolve('node_modules/'+parent,'@img/sharp-wasm32');
    assert.equal(resolve(wasm.key,'@emnapi/runtime').version,'1.11.3');
  }
});
