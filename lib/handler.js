import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {Fault,config,equal,newSession,csrfToken,cookie,originCheck,requireSession,requireCsrf,loginHash} from './security.js';
import {Database} from './database.js';
import {hash,seal,open} from './crypto.js';
import {uuid,validConfig} from './validation.js';
import {oauthToken,accessToken,googleApi,liveVideos} from './youtube.js';
const reply=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const redirect=url=>new Response(null,{status:303,headers:{Location:url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
export function createHandler({env=()=>process.env,dbFactory=s=>new Database(s),startLoop,getRun,services={oauthToken,accessToken,googleApi,liveVideos}}={}){
 return async function handler(request){
  const path=new URL(request.url).pathname.slice('/api/'.length);
  let settings;
  try{
   settings=config(typeof env==='function'?env():env);
   const req={headers:Object.fromEntries(request.headers)},db=dbFactory(settings);
   let body={};
   if(request.method==='POST'){
    if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Fault('Kirim JSON.',415);
    const input=await request.text();if(input.length>256000)throw new Fault('Data terlalu besar.',413);
    try{body=JSON.parse(input);}catch{throw new Fault('JSON tidak valid.');}
   }
   if(path==='login'&&request.method==='POST'){
    originCheck(req,settings);await db.rpc('login_gate',{id:loginHash(req,settings)});
    if(!equal(body.password,settings.CMS_PASSWORD))throw new Fault('Password salah.',401);
    return reply({ok:true},200,{'Set-Cookie':cookie(newSession(settings),settings)});
   }
   const session=requireSession(req,settings);
   if(request.method==='POST')requireCsrf(req,session,settings);
   if(path==='session'&&request.method==='GET')return reply({csrf:csrfToken(session,settings)});
   if(path==='logout'&&request.method==='POST')return reply({ok:true},200,{'Set-Cookie':cookie('',settings,true)});
   if(path==='state'&&request.method==='GET'){
    const state=await db.rpc('snapshot');
    if(state.running&&state.owner&&getRun){try{state.workflow_status=await getRun(state.owner).status;}catch{state.workflow_status='unknown';}}
    return reply(state);
   }
   if(path==='lives'&&request.method==='GET')return reply({lives:await services.liveVideos(await services.accessToken(db,settings))});
   if(path==='youtube/connect'&&request.method==='POST'){
    const state=await db.rpc('snapshot');if(state.running||state.busy)throw new Fault('Stop Loop dulu sebelum login YouTube.',409);
    const id=randomUUID(),verifier=randomBytes(32).toString('base64url');
    await db.rpc('oauth_save',{session:hash(session.id),encrypted:seal({verifier},settings)},id);
    const params=new URLSearchParams({client_id:settings.GOOGLE_CLIENT_ID,redirect_uri:settings.origin+'/api/youtube/callback',response_type:'code',scope:'https://www.googleapis.com/auth/youtube.force-ssl',access_type:'offline',prompt:'consent',state:id,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
    return reply({url:'https://accounts.google.com/o/oauth2/v2/auth?'+params});
   }
   if(path==='youtube/callback'&&request.method==='GET'){
    const params=new URL(request.url).searchParams,id=uuid(params.get('state'));
    const stored=await db.rpc('oauth_take',{session:hash(session.id)},id);
    if(params.has('error')||!params.get('code'))throw new Fault('Izin YouTube belum diberikan. Hubungkan lagi.');
    const token=await services.oauthToken(settings,{grant_type:'authorization_code',code:params.get('code'),redirect_uri:settings.origin+'/api/youtube/callback',code_verifier:open(stored.encrypted,settings).verifier});
    if(!token.refresh_token)throw new Fault('Google belum memberikan akses offline. Hubungkan ulang dengan izin penuh.');
    const channel=(await services.googleApi(token.access_token,'channels',{part:'snippet',mine:'true'})).items?.[0];
    if(!channel)throw new Fault('Akun ini belum memiliki channel YouTube.');
    await db.rpc('connect',{channel_id:channel.id,channel_name:channel.snippet.title,encrypted:seal({refresh_token:token.refresh_token},settings)});
    return redirect(settings.origin+'/cms.html?oauth=ok');
   }
   if(path==='command'&&request.method==='POST'){
    const id=uuid(body.id),action=body.action;
    if(!['configure','start','pause','reset'].includes(action))throw new Fault('Perintah tidak dikenal.');
    let payload={};
    if(action==='pause'&&body.cancel_id)payload={cancel_id:uuid(body.cancel_id)};
    if(action==='configure'){
     payload=validConfig(body.config);
     const state=await db.rpc('snapshot');if(state.running)throw new Fault('Stop Loop dulu sebelum menyimpan antrean.',409);
     const token=await services.accessToken(db,settings),lives=await services.liveVideos(token);
     if(!lives.some(x=>x.id===payload.video_id&&x.channel_id===state.channel_id))throw new Fault('Pilih live aktif milik channel terhubung.');
    }
    await db.rpc(action,payload,id);
    let state=await db.rpc('snapshot');
    if(action==='pause'&&state.owner&&getRun){try{await getRun(state.owner).cancel();}catch{/* DB remains authoritative even if cancellation is temporarily unavailable. */}}
    if(action==='start'&&state.running){
     if(state.owner&&getRun){
      let status;try{status=await getRun(state.owner).status;}catch{throw new Fault('Status pekerjaan cloud belum terjangkau. Coba Start lagi untuk memastikan loop.',503);}
      if(['failed','cancelled','completed'].includes(status)){
       await db.rpc('recover',{generation:state.generation,owner:state.owner},randomUUID());state=await db.rpc('snapshot');
      }
     }
     if(state.ticket){
      try{await startLoop(state.generation,state.ticket);}catch{throw new Fault('Penjadwalan belum terkonfirmasi. Coba lagi dengan ID yang sama.',503);}
     }
    }
    return reply(state);
   }
   throw new Fault('Endpoint tidak ditemukan.',404);
  }catch(e){
   const message=e instanceof Fault?e.message:'Permintaan belum berhasil. Coba lagi.';
   if(path==='youtube/callback'&&settings)return redirect(settings.origin+'/cms.html?oauth_error='+encodeURIComponent(message));
   return reply({error:message},e instanceof Fault?e.status:500);
  }
 };
}
