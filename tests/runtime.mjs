// Local integration: the actual production Next server + Workflow SDK + PostgreSQL SQL.
// No real Google account, Vercel deployment, or YouTube mutation is used.
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createServer as httpsServer} from 'node:https';
import {createServer as netServer} from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const temp=await mkdtemp(join(tmpdir(),'ytloop-runtime-'));
const pg=new PGlite();let server,child,output='';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function rpc(action,payload={},id=randomUUID()){return (await pg.query('select cloud_rpc($1,$2::jsonb,$3::uuid) as r',[action,JSON.stringify(payload),id])).rows[0].r;}
try{
 await pg.exec('create role anon;create role authenticated;create role service_role bypassrls;');await pg.exec(await readFile(new URL('../supabase.sql',import.meta.url),'utf8'));
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(temp,'key.pem'),'-out',join(temp,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});
 server=httpsServer({key:await readFile(join(temp,'key.pem')),cert:await readFile(join(temp,'cert.pem'))},async(req,res)=>{
  try{if(req.headers.apikey!=='sb_secret_runtime')throw Error('Wrong key');
   let text='';for await(const chunk of req)text+=chunk;
   let data;if(req.url.startsWith('/rest/v1/rpc/cloud_rpc')){const p=JSON.parse(text);data=await rpc(p.p_action,p.p_payload,p.p_request);}else throw Error('Unexpected path '+req.url);
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));
  }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({message:e.message}));}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const probe=netServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const origin='http://127.0.0.1:'+port;
 const env={...process.env,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',CMS_PUBLIC_URL:origin,CMS_PASSWORD:'runtime-password-123',SESSION_SECRET:'runtime-'.repeat(8),TOKEN_ENCRYPTION_KEY:'12'.repeat(32),SUPABASE_URL:'https://localhost:'+server.address().port,SUPABASE_SECRET_KEY:'sb_secret_runtime',GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test',NODE_EXTRA_CA_CERTS:join(temp,'cert.pem'),WORKFLOW_TARGET_WORLD:'local',WORKFLOW_LOCAL_BASE_URL:origin,WORKFLOW_LOCAL_DATA_DIR:join(temp,'workflow'),WORKFLOW_LOCAL_RECOVER_ACTIVE_RUNS:'0'};
 child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port),'-H','127.0.0.1'],{env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/cms.html')).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,'Next server readiness');
 let r=await fetch(origin+'/cms.html');assert.equal(r.status,200);assert.ok(r.headers.get('content-security-policy').includes("script-src 'self'"));assert.ok((await r.text()).includes('YouTube Master CMS'));
 assert.equal((await fetch(origin+'/app.js')).status,200);assert.equal((await fetch(origin+'/api/state')).status,401);
 r=await fetch(origin+'/api/login',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({password:env.CMS_PASSWORD})});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];
 const csrf=(await (await fetch(origin+'/api/session',{headers:{cookie}})).json()).csrf;
 await rpc('connect',{channel_id:'c',channel_name:'C',encrypted:'not-used-in-sleep-test'});await rpc('configure',{video_id:'abcdefghijk',titles:['A','B'],interval_minutes:10});await rpc('start');
 // Put the first due time in the future so this integration verifies durable sleep without contacting Google.
 await pg.exec("update ytloop_cloud_state set next_at=now()+interval '10 minutes';");
 const command=async(action)=>fetch(origin+'/api/command',{method:'POST',headers:{cookie,origin,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({id:randomUUID(),action})});
 r=await command('start');assert.equal(r.status,200,await r.text());
 let owner=null;for(let i=0;i<150;i++){const s=await rpc('snapshot');owner=s.owner;if(owner)break;await delay(100);}assert.ok(owner,'Actual Workflow registers an owner');
 let durableSleep=false;for(let i=0;i<100;i++){const files=await readdir(join(temp,'workflow'),{recursive:true});for(const file of files){if(!file.endsWith('.json'))continue;const content=await readFile(join(temp,'workflow',file),'utf8');if(content.includes('wait_created')||content.includes('sleep_created'))durableSleep=true;}if(durableSleep)break;await delay(100);}assert.ok(durableSleep,'Workflow persists durable sleep');
 r=await command('pause');assert.equal(r.status,200);assert.equal((await rpc('snapshot')).running,false);assert.equal((await rpc('snapshot')).current_index,-1);
 console.log('PASS: production HTTP, authenticated commands, real Workflow registration, persisted sleep, and Stop; no Google calls.');
}catch(e){console.error(output.slice(-12000));throw e;}
finally{if(child){child.kill('SIGTERM');await delay(200);}if(server)await new Promise(r=>server.close(r));await pg.close();await rm(temp,{recursive:true,force:true});}
