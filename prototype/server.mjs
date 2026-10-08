import {createDevAIHandler} from './dev-ai.mjs';
import http from 'node:http';
import {readFileSync, createReadStream, statSync, existsSync, realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public/sim');
const args=process.argv.slice(2);
const option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const configured=option('--video-dir',process.env.SIM_VIDEO_DIR||'');
const videoRoot=configured?path.resolve(configured):null;
const port=Number(option('--port',process.env.SIM_MEDIA_PORT||'5174'));
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Porta inválida.');

function csv(text){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(cell);cell='';}
    else if(c==='\n'&&!quoted){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(cell||row.length){row.push(cell);rows.push(row);}
  const headers=(rows.shift()||[]).map(h=>h.replace(/^\uFEFF/,''));
  return rows.filter(r=>r.length===headers.length).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
}
let catalog=[];
if(videoRoot){
  const index=path.join(videoRoot,'indice-videos.csv');
  try{if(existsSync(index))catalog=csv(readFileSync(index,'utf8')).filter(r=>/^[a-f0-9-]+$/i.test(r.id)&&path.basename(r.arquivo)===r.arquivo&&r.arquivo.endsWith('.mp4')).map(r=>({id:r.id,name:r.name||r.arquivo,group:r.muscle_group||'A revisar',equipment:r.equipment||null,file:r.arquivo,bytes:Number(r.tamanho_bytes)||0,provider:'biblioteca fornecida',url:'/api/demo/videos/'+r.id}));}
  catch{console.warn('Catálogo indisponível; confira SIM_VIDEO_DIR.');}
}
const media=new Map(catalog.map(r=>[r.id,r]));
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
function send(req,res,code,type,body){res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);}
const devAI=createDevAIHandler({apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||'gpt-5.4-nano'});
const server=http.createServer({requestTimeout:10000,headersTimeout:10000},async (req,res)=>{
  try{
    const requestHost=new URL('http://'+req.headers.host);
    if(!['127.0.0.1','localhost'].includes(requestHost.hostname))return send(req,res,403,'text/plain','Somente loopback.');
    if(new URL(req.url,'http://127.0.0.1').pathname==='/api/dev-ai'){if(process.env.NODE_ENV==='production')return send(req,res,404,'text/plain','Indisponível.');return await devAI(req,res);}
    if(!['GET','HEAD'].includes(req.method))return send(req,res,405,'text/plain','Preview somente leitura.');
    const url=new URL(req.url,'http://127.0.0.1');
    if(['http://127.0.0.1:5173','http://localhost:5173'].includes(req.headers.origin)){res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');}
    if(url.pathname==='/api/demo/catalog')return send(req,res,200,'application/json',JSON.stringify({demo:true,catalog,available:catalog.length>0}));
    if(url.pathname.startsWith('/api/demo/videos/')){
      const entry=media.get(url.pathname.slice('/api/demo/videos/'.length));
      if(!entry||!videoRoot)return send(req,res,404,'text/plain','Vídeo indisponível.');
      const file=realpathSync(path.join(videoRoot,entry.file));
      const actualRoot=realpathSync(videoRoot);
      if(!file.startsWith(actualRoot+path.sep))return send(req,res,403,'text/plain','Vídeo fora da biblioteca.');
      const size=statSync(file).size;
      let start=0,end=size-1,code=200;
      if(req.headers.range){
        const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if(!match||(!match[1]&&!match[2]))return send(req,res,416,'text/plain','Intervalo inválido.');
        if(!match[1]){const suffix=Number(match[2]);if(suffix<=0)return send(req,res,416,'text/plain','Intervalo inválido.');start=Math.max(0,size-suffix);}
        else{start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size){res.writeHead(416,{'Content-Range':'bytes */'+size});return res.end();}code=206;
      }
      const headers={'Content-Type':'video/mp4','Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
      if(code===206)headers['Content-Range']='bytes '+start+'-'+end+'/'+size;
      res.writeHead(code,headers);
      if(req.method==='HEAD')return res.end();
      const stream=createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());return stream.pipe(res);
    }
    let name=decodeURIComponent(url.pathname).replace(/^\/sim\//,'/');
    if(['/','/app','/comecar','/crm'].includes(name))name='/index.html';
    const allowed=new Set(['index.html','style.css','app.js','domain.js','logo.svg']);
    const file=path.resolve(root,'.'+name);
    if(path.dirname(file)!==root||!allowed.has(path.basename(file)))return send(req,res,404,'text/plain','Não encontrado.');
    const body=readFileSync(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);
  }catch(error){if(!res.headersSent)send(req,res,error.code==='ENOENT'?404:500,'text/plain','Não foi possível abrir este recurso local.');else res.destroy();}
});
server.listen(port,'127.0.0.1',()=>console.log('SIM preview local: http://127.0.0.1:'+port+' | '+catalog.length+' vídeos | dados fictícios'));
