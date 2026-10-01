-- v3 berdiri sendiri; tidak mengubah tabel v2. Jalankan sekali di SQL Editor.
create table if not exists public.ytloop_cloud_state (
 id integer primary key check(id=1), config jsonb not null default '{}', running boolean not null default false,
 generation uuid, ticket uuid, owner text, current_index integer not null default -1, cycles integer not null default 0,
 current_title text not null default '', next_at timestamptz, last_error text not null default '',
 channel_id text not null default '', channel_name text not null default '', pending jsonb,
 lease uuid, lease_until timestamptz, updated_at timestamptz not null default now()
);
insert into public.ytloop_cloud_state(id) values(1) on conflict do nothing;
create table if not exists public.ytloop_cloud_tokens(id integer primary key check(id=1), encrypted text not null);
create table if not exists public.ytloop_cloud_requests(id uuid primary key, action text not null, payload jsonb not null, result jsonb not null, created_at timestamptz not null default now());
create table if not exists public.ytloop_cloud_oauth(id uuid primary key, payload jsonb not null, expires_at timestamptz not null);
create table if not exists public.ytloop_cloud_log(id bigint generated always as identity primary key, message text not null, created_at timestamptz not null default now());
create table if not exists public.ytloop_cloud_limits(id text primary key, attempts integer not null default 0, started_at timestamptz not null default now());

create or replace function public.cloud_snapshot() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('config',config,'running',running,'generation',generation,'ticket',ticket,'owner',owner,
 'current_index',current_index,'cycles',cycles,'current_title',current_title,'next_at',next_at,'last_error',last_error,
 'channel_id',channel_id,'channel_name',channel_name,'pending',pending is not null,
 'busy',lease is not null and lease_until>now(),'updated_at',updated_at,
 'logs',coalesce((select jsonb_agg(row_to_json(l)) from (select message,created_at from ytloop_cloud_log order by id desc limit 40) l),'[]'::jsonb))
 from ytloop_cloud_state where id=1;
$$;

create or replace function public.cloud_rpc(p_action text,p_payload jsonb default '{}',p_request uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s ytloop_cloud_state%rowtype; prior ytloop_cloud_requests%rowtype; result jsonb; idx integer; n integer; item jsonb; stored jsonb; remaining bigint;
begin
 if p_action='snapshot' then return cloud_snapshot(); end if;
 if p_action='login_gate' then
   insert into ytloop_cloud_limits(id) values(p_payload->>'id') on conflict do nothing;
   perform 1 from ytloop_cloud_limits where id=p_payload->>'id' for update;
   update ytloop_cloud_limits set attempts=0,started_at=now() where id=p_payload->>'id' and started_at<now()-interval '15 minutes';
   if (select attempts from ytloop_cloud_limits where id=p_payload->>'id')>=8 then raise exception 'LOGIN_LIMIT'; end if;
   update ytloop_cloud_limits set attempts=attempts+1 where id=p_payload->>'id';
   delete from ytloop_cloud_limits where started_at<now()-interval '2 days'; return '{}'::jsonb;
 end if;
 if p_action='oauth_save' then
   delete from ytloop_cloud_oauth where expires_at<now();
   insert into ytloop_cloud_oauth values(p_request,p_payload,now()+interval '10 minutes'); return '{}'::jsonb;
 end if;
 if p_action='oauth_take' then
   delete from ytloop_cloud_oauth where id=p_request and expires_at>now() and payload->>'session'=p_payload->>'session' returning payload into stored;
   if stored is null then raise exception 'OAUTH_EXPIRED'; end if; return stored;
 end if;
 select * into s from ytloop_cloud_state where id=1 for update;
 if p_action in ('configure','start','pause','reset') then
   select * into prior from ytloop_cloud_requests where id=p_request;
   if found then
     if prior.action<>p_action or prior.payload<>p_payload then raise exception 'ID_REUSED'; end if;
     return prior.result;
   end if;
 end if;
 if p_action='retoken' then
   update ytloop_cloud_tokens set encrypted=p_payload->>'encrypted' where id=1 and encrypted=p_payload->>'previous';
   return '{}'::jsonb;
 elsif p_action='connect' then
   if s.running then raise exception 'PAUSE_FIRST'; end if;
   if s.lease_until>now() then raise exception 'BUSY'; end if;
   if s.pending is not null and s.channel_id<>p_payload->>'channel_id' then raise exception 'WRONG_CHANNEL'; end if;
   if s.channel_id<>p_payload->>'channel_id' then
     update ytloop_cloud_state set config='{}',current_index=-1,cycles=0,current_title='',next_at=null,pending=null where id=1;
   end if;
   insert into ytloop_cloud_tokens values(1,p_payload->>'encrypted') on conflict(id) do update set encrypted=excluded.encrypted;
   update ytloop_cloud_state set channel_id=p_payload->>'channel_id',channel_name=p_payload->>'channel_name',last_error='',updated_at=now() where id=1;
   insert into ytloop_cloud_log(message) values('Channel YouTube terhubung.');return cloud_snapshot();
 elsif p_action='reset' then
   if s.running then raise exception 'PAUSE_FIRST'; end if;
   if s.lease_until>now() then raise exception 'BUSY'; end if;
   update ytloop_cloud_state set config='{}',pending=null,lease=null,lease_until=null,current_index=-1,cycles=0,current_title='',next_at=null,last_error='',owner=null,generation=null,ticket=null,updated_at=now() where id=1;
   insert into ytloop_cloud_log(message) values('Antrean direset oleh pengguna.');result=cloud_snapshot();
 elsif p_action='configure' then
   if s.running then raise exception 'PAUSE_FIRST'; end if;
   if s.lease_until>now() then raise exception 'BUSY'; end if;
   if s.pending is not null then raise exception 'PENDING'; end if;
   update ytloop_cloud_state set config=p_payload,current_index=-1,cycles=0,current_title='',next_at=null,last_error='',updated_at=now() where id=1;
   insert into ytloop_cloud_log(message) values('Antrean disimpan.');result=cloud_snapshot();
 elsif p_action='start' then
   if not exists(select 1 from ytloop_cloud_tokens where id=1) then raise exception 'CONNECT_FIRST'; end if;
   if jsonb_array_length(coalesce(s.config->'titles','[]'))=0 then raise exception 'NO_CONFIG'; end if;
   if s.lease_until>now() and not s.running then raise exception 'BUSY'; end if;
   if not s.running then
     update ytloop_cloud_state set running=true,generation=p_request,ticket=p_request,owner=null,next_at=now(),last_error='',updated_at=now() where id=1;
     insert into ytloop_cloud_log(message) values('Loop dimulai di cloud.');
   end if;
   result=cloud_snapshot();
 elsif p_action='pause' then
   update ytloop_cloud_state set running=false,updated_at=now() where id=1;
   if p_payload->>'cancel_id' is not null then
     insert into ytloop_cloud_requests(id,action,payload,result) values((p_payload->>'cancel_id')::uuid,'start','{}',cloud_snapshot()) on conflict do nothing;
   end if;
   insert into ytloop_cloud_log(message) values('Stop Loop diminta. Pergantian yang sedang diproses bisa selesai.');result=cloud_snapshot();
 elsif p_action='register' then
   if not s.running or s.generation<> (p_payload->>'generation')::uuid then return jsonb_build_object('stop',true); end if;
   if s.ticket=(p_payload->>'ticket')::uuid then
     update ytloop_cloud_state set owner=p_payload->>'owner',ticket=null,updated_at=now() where id=1;
   elsif s.owner<>p_payload->>'owner' or s.owner is null then return jsonb_build_object('stop',true); end if;
   return jsonb_build_object('stop',false);
 elsif p_action='claim' then
   if not s.running or s.generation<>(p_payload->>'generation')::uuid or s.owner is distinct from p_payload->>'owner' then return jsonb_build_object('stop',true); end if;
   if s.lease_until>now() then return jsonb_build_object('wait_ms',30000); end if;
   if s.next_at>now() then
     remaining=greatest(1000,ceil(extract(epoch from s.next_at-now())*1000)::bigint);
     return jsonb_build_object('wait_ms',remaining);
   end if;
   item=s.pending;
   if item is null then
     n=jsonb_array_length(s.config->'titles'); idx=(s.current_index+1)%n;
     item=jsonb_build_object('id',p_request,'index',idx,'title',s.config->'titles'->>idx,'video_id',s.config->>'video_id',
       'cycles',s.cycles+case when s.current_index=n-1 then 1 else 0 end);
   end if;
   update ytloop_cloud_state set pending=item,lease=p_request,lease_until=now()+interval '90 seconds',updated_at=now() where id=1;
   return jsonb_build_object('job',item,'lease',p_request);
 elsif p_action='allowed' then
   return jsonb_build_object('allowed',s.running and s.generation=(p_payload->>'generation')::uuid and s.owner=p_payload->>'owner' and s.lease=(p_payload->>'lease')::uuid and s.lease_until>now());
 elsif p_action='finish' then
   if s.lease is distinct from (p_payload->>'lease')::uuid then return jsonb_build_object('stop',not s.running,'wait_ms',60000); end if;
   if (p_payload->>'ok')::boolean then
     update ytloop_cloud_state set current_index=(s.pending->>'index')::integer,cycles=(s.pending->>'cycles')::integer,
       current_title=s.pending->>'title',pending=null,lease=null,lease_until=null,last_error='',
       next_at=now()+((s.config->>'interval_minutes')::numeric*interval '1 minute'),updated_at=now() where id=1;
     insert into ytloop_cloud_log(message) values('Judul diganti: '||(s.pending->>'title'));
   else
     update ytloop_cloud_state set lease=null,lease_until=null,last_error=left(p_payload->>'message',500),
       running=running and not coalesce((p_payload->>'permanent')::boolean,false),next_at=now()+interval '1 minute',updated_at=now() where id=1;
     insert into ytloop_cloud_log(message) values(left(p_payload->>'message',500));
   end if;
   delete from ytloop_cloud_log where id not in (select id from ytloop_cloud_log order by id desc limit 200);
   return jsonb_build_object('stop',not (select running from ytloop_cloud_state where id=1),'wait_ms',
     greatest(1000,(select ceil(extract(epoch from next_at-now())*1000)::bigint from ytloop_cloud_state where id=1)));
 elsif p_action='rollover' then
   if not s.running or s.generation<>(p_payload->>'generation')::uuid or s.owner is distinct from p_payload->>'owner' then return jsonb_build_object('stop',true); end if;
   if s.ticket is null then update ytloop_cloud_state set ticket=p_request where id=1; end if;
   return jsonb_build_object('ticket',(select ticket from ytloop_cloud_state where id=1));
 elsif p_action='recover' then
   if not s.running or s.generation<>(p_payload->>'generation')::uuid or s.owner is distinct from p_payload->>'owner' then return jsonb_build_object('stop',true); end if;
   if s.lease_until>now() then raise exception 'BUSY'; end if;
   update ytloop_cloud_state set ticket=p_request,owner=null,updated_at=now() where id=1;
   return cloud_snapshot();
 else raise exception 'UNKNOWN_ACTION';
 end if;
 insert into ytloop_cloud_requests(id,action,payload,result) values(p_request,p_action,p_payload,result);
 delete from ytloop_cloud_requests where created_at<now()-interval '30 days';
 return result;
end;
$$;

alter table public.ytloop_cloud_state enable row level security;
alter table public.ytloop_cloud_tokens enable row level security;
alter table public.ytloop_cloud_requests enable row level security;
alter table public.ytloop_cloud_oauth enable row level security;
alter table public.ytloop_cloud_log enable row level security;
alter table public.ytloop_cloud_limits enable row level security;
revoke all on public.ytloop_cloud_state,public.ytloop_cloud_tokens,public.ytloop_cloud_requests,public.ytloop_cloud_oauth,public.ytloop_cloud_log,public.ytloop_cloud_limits from anon,authenticated;
revoke execute on function public.cloud_snapshot() from public,anon,authenticated;
revoke execute on function public.cloud_rpc(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.cloud_snapshot(),public.cloud_rpc(text,jsonb,uuid) to service_role;
grant select on public.ytloop_cloud_tokens to service_role;
