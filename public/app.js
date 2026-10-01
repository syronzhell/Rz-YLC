const $=id=>document.getElementById(id);
let csrf='',state=null,busy=false,dirty=false,lives=[],poll=null;
let pending;try{pending=JSON.parse(localStorage.getItem('ytloop_cloud_pending')||'null');}catch{pending=null;}
const titles=()=>$('titles').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
function notice(id,message){$(id).textContent=message;$(id).classList.toggle('hidden',!message);}
function toast(message,error=false){$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').classList.remove('hidden');setTimeout(()=>$('toast').classList.add('hidden'),5000);}
async function api(path,body){
 const r=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 let result;try{result=await r.json();}catch{throw Error('Server belum merespons dengan benar.');}
 if(!r.ok){const e=Error(result.error||'Permintaan belum berhasil.');e.status=r.status;throw e;}return result;
}
function applyConfig(){if(!state||dirty)return;const c=state.config||{};$('titles').value=(c.titles||[]).join('\n');$('interval').value=c.interval_minutes||180;renderLives(c.video_id||'');}
function renderLives(selected=$('liveSelect').value||state?.config?.video_id||''){
 $('liveSelect').replaceChildren(new Option('Pilih live aktif…',''));
 for(const live of lives)$('liveSelect').add(new Option(live.title,live.id));
 if(selected&&!lives.some(x=>x.id===selected))$('liveSelect').add(new Option('Live tersimpan · '+selected,selected));
 $('liveSelect').value=selected;
}
function controls(){
 const running=!!state?.running,locked=busy||running||state?.busy||!!state?.pending;
 for(const id of ['titles','interval','liveSelect','importBtn','saveBtn'])$(id).disabled=!!locked;
 $('startBtn').disabled=busy||dirty||!state?.channel_id||!(state?.config?.titles?.length)||!!state?.busy;
 $('startBtn').textContent=running?'Periksa / pulihkan loop':'▶ Start Loop';
 $('stopBtn').disabled=busy||(!running&&pending?.action!=='start');
 $('resetBtn').disabled=busy||running||!!state?.busy;
 $('connectBtn').disabled=busy||running||!!state?.busy;
 $('refreshBtn').disabled=busy||!state?.channel_id;
 $('queueCount').textContent=titles().length+' judul';$('dirtyNotice').classList.toggle('hidden',!dirty);
 $('uncertain').classList.toggle('hidden',!pending);
}
function render(){
 if(!state)return;
 $('loopBadge').textContent=state.running?'RUNNING':state.busy?'STOPPING':'STOP';$('loopBadge').classList.toggle('running',state.running);
 $('currentTitle').textContent=state.current_title||'Belum mengganti judul';$('channelName').textContent=state.channel_name||'Belum terhubung';
 const c=state.config||{},n=c.titles?.length||0;
 $('position').textContent=n&&state.current_index>=0?(state.current_index+1)+' / '+n:'—';$('cycles').textContent=state.cycles;
 $('nextTitle').textContent=n?c.titles[(state.current_index+1)%n]:'Antrean belum tersimpan';
 const link=$('watchLink');link.classList.toggle('hidden',!c.video_id);link.href='https://www.youtube.com/watch?v='+encodeURIComponent(c.video_id||'');
 notice('lastError',state.last_error||'');
 const failed=['failed','cancelled'].includes(state.workflow_status);
 notice('jobNotice',failed&&state.running?'Pekerjaan cloud berhenti. Tekan Periksa / pulihkan loop untuk melanjutkan.':state.pending&&!state.running?'Ada pergantian belum terkonfirmasi. Start memulihkan judul yang sama; Reset membuang antrean.':'');
 $('logs').replaceChildren();for(const log of state.logs||[]){const row=document.createElement('div');row.className='log-line';const time=document.createElement('span');time.className='log-time';time.textContent=new Date(log.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});const message=document.createElement('span');message.textContent=log.message;row.append(time,message);$('logs').append(row);}
 applyConfig();controls();countdown();
}
function countdown(){
 const seconds=state?.running&&state.next_at?Math.max(0,Math.ceil((new Date(state.next_at)-Date.now())/1000)):null;
 $('countdown').textContent=seconds===null?'—':seconds===0?'Memproses…':[Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(x=>String(x).padStart(2,'0')).join(':');
}
async function refresh(){try{state=await api('state');notice('offline','');render();}catch(e){notice('offline',e.message);if(e.status===401)showLogin();}}
async function refreshLives(){try{lives=(await api('lives')).lives;renderLives();notice('livesHint',lives.length?'Pilih satu live yang sedang berjalan.':'Belum ada live aktif di channel ini. Mulai streaming dari RDP, lalu refresh.');}catch(e){notice('livesHint',e.message);}}
function showLogin(){clearInterval(poll);poll=null;csrf='';$('dashboard').classList.add('hidden');$('loginView').classList.remove('hidden');}
async function showDashboard(){
 csrf=(await api('session')).csrf;$('loginView').classList.add('hidden');$('dashboard').classList.remove('hidden');
 await refresh();if(state?.channel_id)await refreshLives();poll=setInterval(refresh,10000);
 const params=new URLSearchParams(location.search);if(params.get('oauth')==='ok')toast('Channel terhubung. Pilih live aktif.');if(params.has('oauth_error'))toast(params.get('oauth_error'),true);history.replaceState({},'',location.pathname);controls();
}
async function runCommand(request,retry=false){
 if(busy)return;busy=true;controls();
 if(!retry){if(pending&&request.action!=='pause'){busy=false;controls();toast('Selesaikan Coba lagi untuk perintah sebelumnya.',true);return;}pending=request;localStorage.setItem('ytloop_cloud_pending',JSON.stringify(pending));}
 try{state=await api('command',request);pending=null;localStorage.removeItem('ytloop_cloud_pending');dirty=false;render();toast('Perintah tersimpan.');}
 catch(e){toast(e.message,true);if(e.status&&e.status<500){pending=null;localStorage.removeItem('ytloop_cloud_pending');}await refresh();}
 finally{busy=false;controls();}
}
function command(action,config){return runCommand({id:crypto.randomUUID(),action,...(config?{config}:{})});}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('login',{password:$('password').value});$('password').value='';notice('loginError','');await showDashboard();}catch(e){notice('loginError',e.message);}});
$('logoutBtn').onclick=async()=>{try{await api('logout',{});showLogin();}catch(e){toast(e.message,true);}};
$('connectBtn').onclick=async()=>{try{const result=await api('youtube/connect',{});location.assign(result.url);}catch(e){toast(e.message,true);}};
$('refreshBtn').onclick=refreshLives;
$('saveBtn').onclick=()=>command('configure',{video_id:$('liveSelect').value,titles:titles(),interval_minutes:Number($('interval').value)});
$('startBtn').onclick=()=>command('start');
$('stopBtn').onclick=()=>runCommand({id:crypto.randomUUID(),action:'pause',...(pending?.action==='start'?{cancel_id:pending.id}:{})});
$('resetBtn').onclick=()=>{if(confirm('Reset menghapus antrean tersimpan dan pergantian yang belum terkonfirmasi. Live tetap berjalan. Lanjutkan?'))command('reset');};
$('retryBtn').onclick=()=>{if(pending)runCommand(pending,true);};
for(const id of ['titles','interval','liveSelect'])$(id).addEventListener('input',()=>{dirty=true;controls();});
$('importBtn').onclick=()=>$('titlesFile').click();
$('titlesFile').onchange=async()=>{const file=$('titlesFile').files[0];if(!file)return;if(file.size>256000){toast('File terlalu besar.',true);return;}$('titles').value=await file.text();dirty=true;controls();$('titlesFile').value='';};
setInterval(countdown,1000);
showDashboard().catch(e=>{showLogin();if(e.status!==401)notice('loginError',e.message);});
