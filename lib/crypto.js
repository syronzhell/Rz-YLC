import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export function seal(value,settings){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(settings.TOKEN_ENCRYPTION_KEY,'hex'),iv);
  cipher.setAAD(Buffer.from('youtube-master-cms:v3'));
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return [iv,cipher.getAuthTag(),encrypted].map(x=>x.toString('base64url')).join('.');
}
export function open(value,settings){
  const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64url'));
  const cipher=createDecipheriv('aes-256-gcm',Buffer.from(settings.TOKEN_ENCRYPTION_KEY,'hex'),iv);
  cipher.setAAD(Buffer.from('youtube-master-cms:v3'));cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8'));
}
