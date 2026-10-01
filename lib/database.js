import {randomUUID} from 'node:crypto';
import {Fault} from './security.js';
export class Database{
  constructor(settings){this.settings=settings;}
  async request(path,method='GET',body){
    const key=this.settings.SUPABASE_SECRET_KEY,headers={apikey:key,'Content-Type':'application/json'};
    if(!key.startsWith('sb_secret_'))headers.Authorization='Bearer '+key;
    let r;try{r=await fetch(this.settings.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});}catch{throw new Fault('Database belum terjangkau. Coba lagi dengan ID permintaan yang sama.',503);}
    if(!r.ok){let e={};try{e=await r.json();}catch{}
      const errors={PAUSE_FIRST:'Stop Loop sebelum mengubah antrean.',BUSY:'Pergantian judul sedang diproses. Tunggu sebentar.',NO_CONFIG:'Simpan antrean dulu.',CONNECT_FIRST:'Hubungkan channel YouTube dulu.',PENDING:'Ada pergantian belum terkonfirmasi. Start untuk memulihkan sebelum mengubah antrean.',WRONG_CHANNEL:'Hubungkan channel yang sama untuk memulihkan pergantian.',LOGIN_LIMIT:'Terlalu banyak percobaan login. Tunggu 15 menit.',OAUTH_EXPIRED:'Login YouTube kedaluwarsa. Hubungkan ulang.',ID_REUSED:'ID permintaan dipakai untuk perintah berbeda.'};
      if(errors[e.message])throw new Fault(errors[e.message],e.message==='LOGIN_LIMIT'?429:409);
      throw new Fault('Database belum siap. Jalankan supabase.sql dan periksa konfigurasi.',503);
    }
    return r.status===204?null:r.json();
  }
  rpc(action,payload={},id=randomUUID()){return this.request('rpc/cloud_rpc','POST',{p_action:action,p_payload:payload,p_request:id});}
  async tokens(){const rows=await this.request('ytloop_cloud_tokens?id=eq.1&select=encrypted');if(!rows?.[0])throw new Fault('Hubungkan channel YouTube dulu.',401);return rows[0].encrypted;}
}
