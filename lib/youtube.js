import {Fault} from './security.js';
import {open,seal} from './crypto.js';
export class YouTubeError extends Fault{
  constructor(message,permanent=false,status=502){super(message,status);this.permanent=permanent;}
}
export async function jsonFetch(url,options={}){
  let r;try{r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(12000)});}catch{throw new YouTubeError('YouTube belum merespons. Akan dicoba lagi dalam 1 menit.');}
  let data={};try{data=await r.json();}catch{throw new YouTubeError('Respons YouTube belum valid. Akan dicoba lagi.');}
  if(!r.ok){
    const reason=data.error?.errors?.[0]?.reason||data.error;
    if(reason==='invalid_grant')throw new YouTubeError('Akses YouTube kedaluwarsa. Hubungkan ulang channel, lalu Start.',true,401);
    if(r.status===401||r.status===403||r.status===404||r.status===400)throw new YouTubeError(reason==='quotaExceeded'||reason==='dailyLimitExceeded'?'Kuota YouTube habis. Tunggu kuota pulih, lalu Start.':'YouTube menolak akses. Periksa channel, izin API, dan live; lalu Start.',true,r.status);
    throw new YouTubeError('YouTube mengalami gangguan. Akan dicoba lagi dalam 1 menit.');
  }
  return data;
}
export async function oauthToken(settings,params){return jsonFetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:settings.GOOGLE_CLIENT_ID,client_secret:settings.GOOGLE_CLIENT_SECRET,...params}).toString()});}
export async function googleApi(token,path,params={},body){
  return jsonFetch('https://www.googleapis.com/youtube/v3/'+path+'?'+new URLSearchParams(params),{method:body?'PUT':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
}
export async function accessToken(db,settings){
  const encrypted=await db.tokens(),stored=open(encrypted,settings);
  const result=await oauthToken(settings,{grant_type:'refresh_token',refresh_token:stored.refresh_token});
  if(!result.access_token)throw new YouTubeError('Token akses tidak tersedia. Hubungkan ulang channel.',true,401);
  // Google normally retains the refresh token. Persist a rotated token without changing the loop.
  if(result.refresh_token&&result.refresh_token!==stored.refresh_token)await db.rpc('retoken',{previous:encrypted,encrypted:seal({refresh_token:result.refresh_token},settings)});
  return result.access_token;
}
export async function liveVideos(token){
  const data=await googleApi(token,'liveBroadcasts',{part:'id,snippet,status',broadcastStatus:'active',broadcastType:'all',maxResults:'50'});
  return (data.items||[]).map(x=>({id:x.id,title:x.snippet?.title||x.id,channel_id:x.snippet?.channelId}));
}
export function updatedSnippet(snippet,title){
  const result={title,description:snippet.description??'',categoryId:snippet.categoryId};
  for(const k of ['tags','defaultLanguage','defaultAudioLanguage'])if(snippet[k]!==undefined)result[k]=snippet[k];
  return result;
}
export async function setTitle(token,job,channelId,allowed=async()=>true){
  const video=(await googleApi(token,'videos',{part:'snippet,liveStreamingDetails',id:job.video_id})).items?.[0];
  if(!video||video.snippet?.channelId!==channelId)throw new YouTubeError('Live tidak ditemukan di channel terhubung. Stop dan reset antrean untuk memilih live lain.',true);
  if(!video.liveStreamingDetails?.actualStartTime||video.liveStreamingDetails.actualEndTime)throw new YouTubeError('Live ini sudah berakhir atau belum dimulai. Stop dan reset antrean untuk memilih live aktif.',true);
  if(!await allowed())return {cancelled:true};
  // Same target is reapplied after uncertain responses; the queue advances only after acknowledgement.
  if(video.snippet.title!==job.title)await googleApi(token,'videos',{part:'snippet'},{id:job.video_id,snippet:updatedSnippet(video.snippet,job.title)});
  return {cancelled:false};
}
