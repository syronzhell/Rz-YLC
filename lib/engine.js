import {randomUUID} from 'node:crypto';
import {accessToken,setTitle,YouTubeError} from './youtube.js';
export async function tick(db,settings,generation,owner,services={accessToken,setTitle}){
  const claim=await db.rpc('claim',{generation,owner},randomUUID());
  if(!claim.job)return claim;
  try{
    const state=await db.rpc('snapshot'),token=await services.accessToken(db,settings);
    const result=await services.setTitle(token,claim.job,state.channel_id,async()=>!!(await db.rpc('allowed',{generation,owner,lease:claim.lease})).allowed);
    if(result.cancelled)return db.rpc('finish',{lease:claim.lease,ok:false,permanent:false,message:'Loop dihentikan sebelum mengirim judul.'});
    return await db.rpc('finish',{lease:claim.lease,ok:true});
  }catch(e){
    // Unknown failures may mean a successful PUT or DB commit with a lost reply: retain the target for reconciliation.
    return db.rpc('finish',{lease:claim.lease,ok:false,permanent:e instanceof YouTubeError&&e.permanent,message:e instanceof YouTubeError?e.message:'Koneksi terganggu. Pergantian yang sama akan dipulihkan dalam 1 menit.'});
  }
}
