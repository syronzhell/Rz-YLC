import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {config,newSession,verifySession,csrfToken,Fault} from '../lib/security.js';
import {seal,open,hash} from '../lib/crypto.js';
import {validConfig} from '../lib/validation.js';
import {Database} from '../lib/database.js';
import {tick} from '../lib/engine.js';
import {createHandler} from '../lib/handler.js';
import {updatedSnippet,setTitle,YouTubeError} from '../lib/youtube.js';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',CMS_PASSWORD:'test-password-at-least-12',SESSION_SECRET:'session-'.repeat(8),TOKEN_ENCRYPTION_KEY:'12'.repeat(32),CMS_PUBLIC_URL:'https://example.vercel.app',GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-client-secret'};
const settings=config(env),queue={video_id:'abcdefghijk',titles:['A','B','C'],interval_minutes:10};
let pg;
const db={async rpc(action,payload={},id=randomUUID()){
 try{return (await pg.query('select cloud_rpc($1,$2::jsonb,$3::uuid) as result',[action,JSON.stringify(payload),id])).rows[0].result;}
 catch(e){const fault=new Fault(e.message,e.message==='LOGIN_LIMIT'?429:409);throw fault;}
},async tokens(){return (await pg.query('select encrypted from ytloop_cloud_tokens where id=1')).rows[0]?.encrypted;}};
before(async()=>{pg=new PGlite();await pg.exec('create role anon;create role authenticated;create role service_role bypassrls;');await pg.exec(await readFile(new URL('../supabase.sql',import.meta.url),'utf8'));});
beforeEach(async()=>{await pg.exec('truncate ytloop_cloud_state,ytloop_cloud_tokens,ytloop_cloud_requests,ytloop_cloud_oauth,ytloop_cloud_log,ytloop_cloud_limits restart identity;insert into ytloop_cloud_state(id) values(1);');});
after(async()=>{await pg.close();});
async function connect(){return db.rpc('connect',{channel_id:'channel-1',channel_name:'Test Channel',encrypted:seal({refresh_token:'never-send-to-client'},settings)});}
async function start(queueOverride=queue){await connect();await db.rpc('configure',queueOverride);const state=await db.rpc('start');const owner='run-'+randomUUID();await db.rpc('register',{generation:state.generation,ticket:state.ticket,owner});return {generation:state.generation,owner};}
const fakeServices={accessToken:async()=> 'access-token',setTitle:async(t,j,c,allowed)=>({cancelled:!await allowed()})};
async function due(){await pg.exec("update ytloop_cloud_state set next_at=now()-interval '1 second';");}
test('session signature, expiration, and password rotation are enforced',()=>{
 const token=newSession(settings);assert.ok(verifySession(token,settings));assert.equal(verifySession(token+'x',settings),null);assert.equal(verifySession(token,{...settings,CMS_PASSWORD:'different-password'}),null);assert.equal(verifySession(token,settings,Date.now()+43201000),null);
});
test('OAuth token encryption authenticates ciphertext and key',()=>{
 const value=seal({refresh_token:'secret'},settings);assert.ok(!value.includes('secret'));assert.equal(open(value,settings).refresh_token,'secret');assert.throws(()=>open(value,{...settings,TOKEN_ENCRYPTION_KEY:'13'.repeat(32)}));
});
test('validates titles, intervals, and video identifiers',()=>{
 assert.deepEqual(validConfig(queue),queue);assert.throws(()=>validConfig({...queue,titles:['<>']}));assert.throws(()=>validConfig({...queue,titles:['😀'.repeat(101)]}));assert.throws(()=>validConfig({...queue,interval_minutes:1}));
});
test('real SQL rotates A B C A and counts a completed cycle',async()=>{
 const run=await start();for(const expected of ['A','B','C','A']){await due();await tick(db,settings,run.generation,run.owner,fakeServices);assert.equal((await db.rpc('snapshot')).current_title,expected);}
 assert.equal((await db.rpc('snapshot')).cycles,1);
});
test('duplicate workflow starts choose one owner',async()=>{
 await connect();await db.rpc('configure',queue);const state=await db.rpc('start');const first=await db.rpc('register',{generation:state.generation,ticket:state.ticket,owner:'first'}),second=await db.rpc('register',{generation:state.generation,ticket:state.ticket,owner:'second'});
 assert.equal(first.stop,false);assert.equal(second.stop,true);assert.equal((await db.rpc('claim',{generation:state.generation,owner:'second'})).stop,true);
});
test('claim lease prevents concurrent writes and waits until next interval',async()=>{
 const run=await start();const first=await db.rpc('claim',run);assert.ok(first.job);assert.equal((await db.rpc('claim',run)).wait_ms,30000);
 await db.rpc('finish',{lease:first.lease,ok:true});const result=await db.rpc('claim',run);assert.ok(result.wait_ms>590000);assert.ok(!result.job);
});
test('lost YouTube response retains same target before advancing',async()=>{
 const run=await start();let applied='';let writes=0;
 const services={accessToken:async()=> 'token',setTitle:async(t,j)=>{if(applied!==j.title){applied=j.title;writes++;throw new YouTubeError('Lost acknowledgement');}return {cancelled:false};}};
 await tick(db,settings,run.generation,run.owner,services);let state=await db.rpc('snapshot');assert.equal(state.pending,true);assert.equal(state.current_index,-1);
 await due();await tick(db,settings,run.generation,run.owner,services);state=await db.rpc('snapshot');assert.equal(state.current_index,0);assert.equal(writes,1);assert.equal(state.pending,false);
});
test('expired worker lease is reclaimed with same persisted target',async()=>{
 const run=await start();const first=await db.rpc('claim',run);await pg.exec("update ytloop_cloud_state set lease_until=now()-interval '1 second';");const second=await db.rpc('claim',run);
 assert.equal(first.job.id,second.job.id);assert.notEqual(first.lease,second.lease);await db.rpc('finish',{lease:first.lease,ok:true});assert.equal((await db.rpc('snapshot')).current_index,-1);
});
test('Stop fences worker before PUT and Start reconciles same pending title',async()=>{
 const run=await start();let called=0;
 await tick(db,settings,run.generation,run.owner,{accessToken:async()=>{await db.rpc('pause');return 'token';},setTitle:async(t,j,c,allowed)=>{if(await allowed())called++;return {cancelled:!await allowed()};}});
 assert.equal(called,0);assert.equal((await db.rpc('snapshot')).running,false);
 const next=await db.rpc('start');await db.rpc('register',{generation:next.generation,ticket:next.ticket,owner:'next'});await tick(db,settings,next.generation,'next',fakeServices);assert.equal((await db.rpc('snapshot')).current_title,'A');
});
test('Stop can tombstone an uncertain Start arriving later',async()=>{
 await connect();await db.rpc('configure',queue);const cancelled=randomUUID();await db.rpc('pause',{cancel_id:cancelled});await db.rpc('start',{},cancelled);assert.equal((await db.rpc('snapshot')).running,false);
});
test('requests are idempotent and reused IDs cannot change intent',async()=>{
 await connect();const id=randomUUID();await db.rpc('configure',queue,id);await db.rpc('configure',queue,id);assert.equal((await db.rpc('snapshot')).logs.length,2);await assert.rejects(db.rpc('pause',{},id),/ID_REUSED/);
});
test('active and unconfirmed loops block config; reset recovers an ended live',async()=>{
 const run=await start();await assert.rejects(db.rpc('configure',queue),/PAUSE_FIRST/);
 await tick(db,settings,run.generation,run.owner,{accessToken:async()=> 't',setTitle:async()=>{throw new YouTubeError('Live ended',true);}});
 await assert.rejects(db.rpc('configure',queue),/PENDING/);await db.rpc('reset');await db.rpc('configure',queue);assert.equal((await db.rpc('snapshot')).pending,false);
});
test('rollover child replaces owner and stale parent cannot mutate',async()=>{
 const run=await start();const rollover=await db.rpc('rollover',run);const registered=await db.rpc('register',{generation:run.generation,ticket:rollover.ticket,owner:'child'});assert.equal(registered.stop,false);assert.equal((await db.rpc('claim',run)).stop,true);
});
test('30-day sleep does not overflow PostgreSQL integer',async()=>{
 const run=await start({...queue,interval_minutes:43200});await tick(db,settings,run.generation,run.owner,fakeServices);const claimed=await db.rpc('claim',run);assert.ok(claimed.wait_ms>2500000000);
});
test('OAuth state is bound to session, one-time, and expires',async()=>{
 const id=randomUUID();await db.rpc('oauth_save',{session:'one',encrypted:'secret'},id);await assert.rejects(db.rpc('oauth_take',{session:'two'},id),/OAUTH_EXPIRED/);assert.equal((await db.rpc('oauth_take',{session:'one'},id)).encrypted,'secret');await assert.rejects(db.rpc('oauth_take',{session:'one'},id),/OAUTH_EXPIRED/);
 const expired=randomUUID();await db.rpc('oauth_save',{session:'one'},expired);await pg.exec("update ytloop_cloud_oauth set expires_at=now()-interval '1 second';");await assert.rejects(db.rpc('oauth_take',{session:'one'},expired),/OAUTH_EXPIRED/);
});
test('snapshot never returns stored Google credentials',async()=>{
 await connect();const state=JSON.stringify(await db.rpc('snapshot'));assert.ok(!state.includes('refresh_token'));assert.ok(!state.includes('never-send-to-client'));assert.ok(!state.includes('encrypted'));
});
test('anon has no RPC or token permissions',async()=>{
 const r=await pg.query("select has_function_privilege('anon','cloud_rpc(text,jsonb,uuid)','EXECUTE') f,has_table_privilege('anon','ytloop_cloud_tokens','SELECT') t;");assert.equal(r.rows[0].f,false);assert.equal(r.rows[0].t,false);
});
test('login rate gate rejects ninth attempt in same window',async()=>{
 for(let i=0;i<8;i++)await db.rpc('login_gate',{id:'address'});await assert.rejects(db.rpc('login_gate',{id:'address'}),/LOGIN_LIMIT/);
});
test('preserves writable snippet fields and excludes read-only/status fields',()=>{
 const snippet={title:'old',description:'keep',tags:['music'],categoryId:'10',defaultLanguage:'en',defaultAudioLanguage:'en',channelId:'c',thumbnails:{},publishedAt:'x'};
 assert.deepEqual(updatedSnippet(snippet,'new'),{title:'new',description:'keep',tags:['music'],categoryId:'10',defaultLanguage:'en',defaultAudioLanguage:'en'});
});
test('YouTube reconciliation skips PUT when target title already exists',async()=>{
 const old=globalThis.fetch;let writes=0;
 globalThis.fetch=async(u,o)=>{if(o.method==='PUT'){writes++;return Response.json({});}return Response.json({items:[{snippet:{channelId:'c',title:'A',categoryId:'10'},liveStreamingDetails:{actualStartTime:'now'}}]});};
 try{await setTitle('token',{video_id:queue.video_id,title:'A'},'c');assert.equal(writes,0);await setTitle('token',{video_id:queue.video_id,title:'B'},'c',async()=>false);assert.equal(writes,0);await setTitle('token',{video_id:queue.video_id,title:'B'},'c');assert.equal(writes,1);}finally{globalThis.fetch=old;}
});
test('REST secret keys use apikey without a non-JWT bearer',async()=>{
 const old=globalThis.fetch;let headers;
 globalThis.fetch=async(u,o)=>{headers=o.headers;return Response.json({});};try{await new Database(settings).rpc('snapshot');assert.equal(headers.apikey,'sb_secret_test');assert.equal(headers.Authorization,undefined);await new Database({...settings,SUPABASE_SECRET_KEY:'legacy.jwt.key'}).rpc('snapshot');assert.equal(headers.Authorization,'Bearer legacy.jwt.key');}finally{globalThis.fetch=old;}
});
test('HTTP handler enforces login, CSRF and emits no credential fields',async()=>{
 const handler=createHandler({env,dbFactory:()=>db,startLoop:async()=>{},getRun:()=>({status:Promise.resolve('running'),cancel:async()=>{}})});
 let r=await handler(new Request(settings.origin+'/api/state'));assert.equal(r.status,401);
 r=await handler(new Request(settings.origin+'/api/login',{method:'POST',headers:{origin:settings.origin,'Content-Type':'application/json'},body:JSON.stringify({password:env.CMS_PASSWORD})}));assert.equal(r.status,200);const sessionCookie=r.headers.get('set-cookie').split(';')[0];assert.ok(r.headers.get('set-cookie').includes('HttpOnly'));
 r=await handler(new Request(settings.origin+'/api/session',{headers:{cookie:sessionCookie}}));const csrf=(await r.json()).csrf;
 const post=token=>new Request(settings.origin+'/api/command',{method:'POST',headers:{cookie:sessionCookie,origin:settings.origin,'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify({id:randomUUID(),action:'pause'})});
 assert.equal((await handler(post('wrong'))).status,403);assert.equal((await handler(post(csrf))).status,200);
});
test('OAuth HTTP callback binds session, exchanges PKCE, stores only encrypted refresh token',async()=>{
 const sessionToken=newSession(settings),session=verifySession(sessionToken,settings),cookie='ytloop_session='+sessionToken;
 const handler=createHandler({env,dbFactory:()=>db,services:{oauthToken:async(s,p)=>{assert.ok(p.code_verifier);return {access_token:'a',refresh_token:'secret-refresh'};},googleApi:async()=>({items:[{id:'c',snippet:{title:'C'}}]})}});
 let r=await handler(new Request(settings.origin+'/api/youtube/connect',{method:'POST',headers:{cookie,origin:settings.origin,'Content-Type':'application/json','X-CSRF-Token':csrfToken(session,settings)},body:'{}'}));
 const url=new URL((await r.json()).url);assert.equal(url.searchParams.get('access_type'),'offline');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 r=await handler(new Request(settings.origin+'/api/youtube/callback?code=abc&state='+url.searchParams.get('state'),{headers:{cookie}}));assert.equal(r.status,303);assert.ok(r.headers.get('Location').endsWith('oauth=ok'));assert.equal(open(await db.tokens(),settings).refresh_token,'secret-refresh');
});
