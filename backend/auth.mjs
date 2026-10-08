import {randomBytes,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt);
const settings={N:32768,r:8,p:1,maxmem:64*1024*1024};
export async function hashPassword(password){
  if(typeof password!=='string'||password.length<12||password.length>128)throw Error('Password must contain 12–128 characters.');
  const salt=randomBytes(16);const key=await derive(password,salt,64,settings);
  return 'scrypt$32768$8$1$'+salt.toString('hex')+'$'+key.toString('hex');
}
export async function verifyPassword(password,stored){
  if(typeof password!=='string'||password.length>128)return false;
  const parts=stored.split('$');if(parts.length!==6||parts.slice(0,4).join('$')!=='scrypt$32768$8$1'||!/^[a-f0-9]{32}$/.test(parts[4])||!/^[a-f0-9]{128}$/.test(parts[5]))return false;
  const actual=await derive(password,Buffer.from(parts[4],'hex'),64,settings);
  return timingSafeEqual(actual,Buffer.from(parts[5],'hex'));
}
export const tokenHash=token=>createHash('sha256').update(token).digest('hex');
export const newToken=()=>randomBytes(32).toString('base64url');
