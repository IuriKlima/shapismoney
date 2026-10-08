import {emitKeypressEvents} from 'node:readline';
export function hiddenInput(prompt,{input=process.stdin,output=process.stdout}={}){
  if(!input.isTTY||!output.isTTY||typeof input.setRawMode!=='function')return Promise.reject(Error('Use um terminal interativo seguro; entrada redirecionada não é aceita.'));
  return new Promise((resolve,reject)=>{
    let value='',settled=false;const wasRaw=Boolean(input.isRaw),wasPaused=input.isPaused()||input.readableFlowing!==true;
    const cleanup=()=>{input.off('keypress',keypress);input.off('end',cancel);input.off('error',cancel);input.setRawMode(wasRaw);if(wasPaused)input.pause();};
    const finish=(error)=>{if(settled)return;settled=true;cleanup();output.write('\n');if(error){value='';reject(Error(error));}else{const result=value;value='';resolve(result);}};
    const cancel=()=>finish('Entrada cancelada.');
    const keypress=(str,key={})=>{
      if(key.ctrl&&['c','d'].includes(key.name))return cancel();
      if(['return','enter'].includes(key.name))return finish();
      if(['backspace','delete'].includes(key.name)){value=Array.from(value).slice(0,-1).join('');return;}
      if(key.ctrl||key.meta||typeof str!=='string'||/[\u0000-\u001f\u007f]/.test(str))return;
      if(value.length+str.length>128)return finish('A senha excede 128 caracteres.');value+=str;
    };
    output.write(prompt);emitKeypressEvents(input);input.setRawMode(true);input.on('keypress',keypress);input.once('end',cancel);input.once('error',cancel);input.resume();
  });
}
