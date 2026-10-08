import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

async function start(videoDir){
  const reservation=net.createServer();await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,[fileURLToPath(new URL('../prototype/server.mjs',import.meta.url)),'--port',String(port),'--video-dir',videoDir],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Media server did not start')),10000);child.once('error',e=>{clearTimeout(timeout);reject(e);});child.once('exit',code=>{clearTimeout(timeout);reject(Error('Media server exited '+code));});child.stdout.once('data',()=>{clearTimeout(timeout);resolve();});});
  return {origin:'http://127.0.0.1:'+port,port,stop:async()=>{if(child.exitCode!==null)return;await new Promise(resolve=>{child.once('exit',resolve);child.kill();});}};
}
test('mídia local usa catálogo configurado, range e allowlist, sem ler arquivos externos',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sim-media-test-'));
  const absolute=path.resolve(directory);
  assert.ok(absolute.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(absolute).startsWith('sim-media-test-'));
  fs.writeFileSync(path.join(directory,'demo.mp4'),'abcdefgh');
  fs.writeFileSync(path.join(directory,'indice-videos.csv'),'id,name,muscle_group,equipment,arquivo,tamanho_bytes\naaa-1,Exercício fictício,Demo,,demo.mp4,8\nbbb-2,Fora,Demo,,../outside.mp4,8\n');
  const server=await start(directory);
  try{
    const catalog=await (await fetch(server.origin+'/api/demo/catalog')).json();assert.equal(catalog.available,true);assert.equal(catalog.catalog.length,1);
    const video=await fetch(server.origin+'/api/demo/videos/aaa-1',{headers:{Range:'bytes=1-3'}});assert.equal(video.status,206);assert.equal(video.headers.get('Content-Range'),'bytes 1-3/8');assert.equal(await video.text(),'bcd');
    const head=await fetch(server.origin+'/api/demo/videos/aaa-1',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('Content-Length'),'8');
    assert.equal((await fetch(server.origin+'/api/demo/videos/aaa-1',{headers:{Range:'bytes=-0'}})).status,416);
    assert.equal((await fetch(server.origin+'/.env.local')).status,404);
    assert.equal((await fetch(server.origin+'/nested/app.js')).status,404);
    assert.equal((await fetch(server.origin+'/api/demo/catalog',{method:'POST'})).status,405);
    const hostile=await new Promise((resolve,reject)=>{const request=http.get({hostname:'127.0.0.1',port:server.port,path:'/',headers:{Host:'example.com'}},res=>{res.resume();resolve(res.statusCode);});request.on('error',reject);});assert.equal(hostile,403);
    const svg=await (await fetch(server.origin+'/sim/logo.svg')).text();assert.equal((svg.match(/<path /g)||[]).length,12);assert.match(svg,/Shape IS Money/);
  }finally{await server.stop();fs.rmSync(absolute,{recursive:true,force:true});}
});
test('biblioteca ausente retorna catálogo vazio honesto',async()=>{
  const server=await start(path.join(os.tmpdir(),'sim-media-nonexistent-'+crypto.randomUUID()));
  try{const catalog=await (await fetch(server.origin+'/api/demo/catalog')).json();assert.deepEqual(catalog,{demo:true,catalog:[],available:false});assert.equal((await fetch(server.origin+'/api/demo/videos/aaa-1')).status,404);}
  finally{await server.stop();}
});
