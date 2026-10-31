-- Runtime records retain validated application contracts in JSONB. Ownership, identity,
-- uniqueness and relational projections are enforced by Postgres, independently of the web app.
create extension if not exists pgcrypto;

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.users enable row level security;
create policy users_read_self on public.users for select to authenticated using ((select auth.uid())=id);
grant select on public.users to authenticated;
grant all on public.users to service_role;

create function public.sync_auth_user() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.users(id) values(new.id) on conflict do nothing; return new; end $$;
revoke all on function public.sync_auth_user() from public,anon,authenticated;
create trigger career_auth_user after insert on auth.users for each row execute function public.sync_auth_user();
insert into public.users(id) select id from auth.users on conflict do nothing;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'candidate_profiles','profile_versions','applications','agent_runs','application_events',
    'approval_requests','screening_answers','generated_resumes','resume_templates','messages',
    'subscriptions','usage_events','integration_connections','job_sources','notifications',
    'profile_sources','agent_actions','education','experiences','projects','skills','achievements',
    'career_tracks','job_preferences','resume_configurations','jobs','browser_sessions_metadata'
  ] loop
    execute format('create table public.%I (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references public.users(id) on delete cascade,
      data jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(id,user_id),
      check (jsonb_typeof(data) = ''object''),
      check (data ? ''id'' and data->>''id'' = id::text),
      check (data ? ''userId'' and data->>''userId'' = user_id::text)
    )',table_name);
    execute format('alter table public.%I enable row level security',table_name);
    execute format('create index %I on public.%I(user_id,created_at desc)',table_name||'_owner_time',table_name);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid())=user_id)',table_name||'_read_own',table_name);
    -- Changes go through server-side validation. Clients cannot grant subscriptions, approve
    -- themselves, fabricate receipts, consume credits, or alter queue state via the Data API.
    execute format('revoke all on public.%I from anon,authenticated',table_name);
    execute format('grant select on public.%I to authenticated',table_name);
    execute format('grant all on public.%I to service_role',table_name);
  end loop;
end $$;

create unique index candidate_profile_per_user on public.candidate_profiles(user_id);
create unique index subscription_per_user on public.subscriptions(user_id);
create unique index application_dedup_url on public.applications(user_id,(data->>'jobUrl'));
create unique index job_dedup_url on public.jobs(user_id,(data->>'canonicalUrl'));
create index applications_status on public.applications(user_id,(data->>'status'));
create index runs_queue on public.agent_runs((data->>'status'),(data->>'nextAttemptAt'),created_at);
create index usage_month_kind on public.usage_events(user_id,created_at,(data->>'kind'));
create unique index verified_submission_once on public.usage_events(user_id,(data->>'applicationId')) where data->>'kind'='verified_submission';
create index events_application on public.application_events(user_id,(data->>'applicationId'),created_at);
create index approvals_pending on public.approval_requests(user_id,(data->>'status'));
create index answers_scope on public.screening_answers(user_id,(data->>'key'),(data->>'scope'));

-- Relational inventory projections stay in the same transaction as the canonical
-- profile, so importing/editing a profile cannot leave stale skill or experience rows.
create function public.sync_profile_inventory()returns trigger language plpgsql security invoker set search_path='' as $$
declare destination text;source_key text;item jsonb;row_id uuid;ordinal bigint;profile jsonb=new.data->'profile';
begin
  foreach destination in array array['education','experiences','projects','skills','achievements','career_tracks','job_preferences','resume_configurations']loop
    execute format('delete from public.%I where user_id=$1',destination)using new.user_id;
  end loop;
  foreach source_key in array array['education','experiences','projects','skills','claims']loop
    destination=case when source_key='claims' then 'achievements' else source_key end;
    for item,ordinal in select value,ordinality from jsonb_array_elements(coalesce(profile->source_key,'[]'))with ordinality loop
      if source_key='claims' and item->>'type'<>'achievement' then continue;end if;
      if jsonb_typeof(item)<>'object' then item=jsonb_build_object('name',item#>>'{}');end if;
      row_id=md5(new.user_id::text||':'||destination||':'||coalesce(item->>'id',ordinal::text))::uuid;
      item=item||jsonb_build_object('id',row_id,'userId',new.user_id,'profileId',new.id,'createdAt',new.created_at,'updatedAt',new.updated_at);
      execute format('insert into public.%I(id,user_id,data,created_at,updated_at)values($1,$2,$3,$4,$5)',destination)using row_id,new.user_id,item,new.created_at,new.updated_at;
    end loop;
  end loop;
  for item,ordinal in select value,ordinality from jsonb_array_elements(coalesce(profile#>'{preferences,tracks}','[]'))with ordinality loop
    row_id=md5(new.user_id::text||':track:'||ordinal::text)::uuid;
    insert into public.career_tracks(id,user_id,data)values(row_id,new.user_id,jsonb_build_object('id',row_id,'userId',new.user_id,'track',item,'profileId',new.id,'createdAt',new.created_at,'updatedAt',new.updated_at));
  end loop;
  row_id=md5(new.user_id::text||':preferences')::uuid;
  insert into public.job_preferences(id,user_id,data)values(row_id,new.user_id,coalesce(profile->'preferences','{}')||jsonb_build_object('id',row_id,'userId',new.user_id,'profileId',new.id,'createdAt',new.created_at,'updatedAt',new.updated_at));
  row_id=md5(new.user_id::text||':resume-configuration')::uuid;
  insert into public.resume_configurations(id,user_id,data)values(row_id,new.user_id,jsonb_build_object('id',row_id,'userId',new.user_id,'profileId',new.id,'defaultTemplate',profile->'defaultTemplate','trackTemplates',profile->'trackTemplates','createdAt',new.created_at,'updatedAt',new.updated_at));
  return new;
end$$;
revoke all on function public.sync_profile_inventory()from public,anon,authenticated;
create trigger career_inventory after insert or update on public.candidate_profiles for each row execute function public.sync_profile_inventory();

create function public.sync_application_job()returns trigger language plpgsql security invoker set search_path='' as $$
declare job_data jsonb=new.data->'job';job_id uuid;
begin
  if job_data is null or jsonb_typeof(job_data)<>'object' or job_data->>'canonicalUrl' is null then return new;end if;
  job_id=md5(new.user_id::text||':job:'||(job_data->>'canonicalUrl'))::uuid;
  insert into public.jobs(id,user_id,data)values(job_id,new.user_id,job_data||jsonb_build_object('id',job_id,'userId',new.user_id,'createdAt',new.created_at,'updatedAt',new.updated_at))on conflict(id)do update set data=excluded.data,updated_at=now()where jobs.user_id=excluded.user_id;
  return new;
end$$;
revoke all on function public.sync_application_job()from public,anon,authenticated;
create trigger career_job_inventory after insert or update on public.applications for each row execute function public.sync_application_job();

-- Composite foreign keys prevent linking a record to another tenant's application.
alter table public.application_events add column application_id uuid generated always as (nullif(data->>'applicationId','')::uuid) stored;
alter table public.application_events add constraint events_owned_application foreign key(application_id,user_id) references public.applications(id,user_id) on delete cascade;
alter table public.approval_requests add column application_id uuid generated always as (nullif(data->>'applicationId','')::uuid) stored;
alter table public.approval_requests add constraint approvals_owned_application foreign key(application_id,user_id) references public.applications(id,user_id) on delete cascade;
alter table public.generated_resumes add column application_id uuid generated always as (nullif(data->>'applicationId','')::uuid) stored;
alter table public.generated_resumes add constraint resumes_owned_application foreign key(application_id,user_id) references public.applications(id,user_id) on delete cascade;

-- A whitelist prevents SQL identifiers supplied by the service from addressing other tables.
create function public.save_owned_record(p_table text,p_id uuid,p_user_id uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_table <> all(array['candidate_profiles','profile_versions','applications','agent_runs','application_events','approval_requests','screening_answers','generated_resumes','resume_templates','messages','subscriptions','usage_events','integration_connections','job_sources','notifications','profile_sources','agent_actions']) then raise exception 'Unknown record collection'; end if;
  if p_data->>'userId' <> p_user_id::text or p_data->>'id' <> p_id::text then raise exception 'Record ownership mismatch'; end if;
  execute format('insert into public.%I as target(id,user_id,data,created_at,updated_at) values($1,$2,$3,coalesce(($3->>''createdAt'')::timestamptz,now()),now()) on conflict(id) do update set data=excluded.data,updated_at=now() where target.user_id=excluded.user_id returning data',p_table)
    into result using p_id,p_user_id,p_data;
  if result is null then raise exception 'Record belongs to another user'; end if;
  return result;
end $$;

create function public.claim_agent_run(p_worker_id text,p_lease_seconds integer default 300,p_concurrency integer default 2)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare chosen public.agent_runs; next_data jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('career-worker-concurrency',0));
  update public.applications app set data=app.data||jsonb_build_object('status',case when app.data->>'submissionStartedAt' is not null then 'submission_unverified' else 'failed' end,'error','Worker lease expired after maximum attempts; verify any submission receipt before continuing','updatedAt',now()),updated_at=now()
    from public.agent_runs run where run.data->>'applicationId'=app.id::text and run.user_id=app.user_id and run.data->>'status'='running' and (run.data->>'leaseUntil')::timestamptz<now() and (run.data->>'attempts')::integer >= (run.data->>'maxAttempts')::integer and app.data#>>'{receipt,verifiedAt}' is null;
  update public.agent_runs set data=data||jsonb_build_object('status','failed','stage','failed','leaseUntil',null,'error','Worker lease expired after maximum attempts','updatedAt',now()),updated_at=now()
    where data->>'status'='running' and (data->>'leaseUntil')::timestamptz<now() and (data->>'attempts')::integer >= (data->>'maxAttempts')::integer;
  if (select count(*) from public.agent_runs where data->>'status'='running' and (data->>'leaseUntil')::timestamptz>now()) >= greatest(1,least(p_concurrency,20)) then return null; end if;
  select candidate.* into chosen from public.agent_runs candidate where (candidate.data->>'attempts')::integer < (candidate.data->>'maxAttempts')::integer and
    ((candidate.data->>'status'='queued' and (candidate.data->>'nextAttemptAt')::timestamptz<=now()) or (candidate.data->>'status'='running' and (candidate.data->>'leaseUntil')::timestamptz<=now()))
    and not exists(select 1 from public.agent_runs peer where peer.user_id=candidate.user_id and peer.id<>candidate.id and peer.data->>'status'='running' and (peer.data->>'leaseUntil')::timestamptz>now())
    order by candidate.created_at for update skip locked limit 1;
  if chosen.id is null then return null; end if;
  next_data=chosen.data||jsonb_build_object('status','running','attempts',(chosen.data->>'attempts')::integer+1,'leaseUntil',now()+make_interval(secs=>greatest(30,least(p_lease_seconds,900))),'startedAt',coalesce(chosen.data->>'startedAt',now()::text),'updatedAt',now());
  update public.agent_runs set data=next_data,updated_at=now() where id=chosen.id;
  return next_data;
end $$;

create function public.reserve_submission(p_user_id uuid,p_application_id uuid,p_limit integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare count_used integer; event_id uuid=gen_random_uuid();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  if not exists(select 1 from public.applications where id=p_application_id and user_id=p_user_id) then raise exception 'Application not found'; end if;
  if exists(select 1 from public.usage_events where user_id=p_user_id and data->>'applicationId'=p_application_id::text and data->>'kind' in ('reservation','verified_submission')) then return true; end if;
  select count(distinct data->>'applicationId') into count_used from public.usage_events where user_id=p_user_id and created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC' and data->>'kind' in ('reservation','verified_submission');
  if count_used>=p_limit or p_limit<1 then return false; end if;
  insert into public.usage_events(id,user_id,data) values(event_id,p_user_id,jsonb_build_object('id',event_id,'userId',p_user_id,'createdAt',now(),'updatedAt',now(),'kind','reservation','applicationId',p_application_id,'quantity',1,'costUsd',0));
  return true;
end $$;

create function public.record_verified_submission(p_user_id uuid,p_application_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare app public.applications;event_id uuid=gen_random_uuid();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select * into app from public.applications where id=p_application_id and user_id=p_user_id for update;
  if app.id is null or app.data#>>'{receipt,verifiedAt}' is null then raise exception 'Verifiable receipt required'; end if;
  if exists(select 1 from public.usage_events where user_id=p_user_id and data->>'applicationId'=p_application_id::text and data->>'kind'='verified_submission') then return; end if;
  delete from public.usage_events where user_id=p_user_id and data->>'applicationId'=p_application_id::text and data->>'kind'='reservation';
  insert into public.usage_events(id,user_id,data) values(event_id,p_user_id,jsonb_build_object('id',event_id,'userId',p_user_id,'createdAt',now(),'updatedAt',now(),'kind','verified_submission','applicationId',p_application_id,'quantity',1,'costUsd',0));
end $$;
create function public.release_submission(p_user_id uuid,p_application_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  if exists(select 1 from public.applications where id=p_application_id and user_id=p_user_id and data->>'submissionStartedAt' is null) then
    delete from public.usage_events where user_id=p_user_id and data->>'applicationId'=p_application_id::text and data->>'kind'='reservation';
  end if;
end $$;

create table public.rate_limits(key text primary key,hits integer not null,expires_at timestamptz not null);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon,authenticated;
grant all on public.rate_limits to service_role;
create function public.consume_rate_limit(p_key text,p_limit integer,p_window_seconds integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare result integer;
begin
  insert into public.rate_limits as limits(key,hits,expires_at)values(p_key,1,now()+make_interval(secs=>p_window_seconds))
  on conflict(key)do update set hits=case when limits.expires_at<=now() then 1 else limits.hits+1 end,expires_at=case when limits.expires_at<=now() then excluded.expires_at else limits.expires_at end returning hits into result;
  return result<=p_limit;
end $$;
create table public.webhook_events(id text primary key,status text not null check(status in('processing','processed','failed')),updated_at timestamptz not null default now());
alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from anon,authenticated;
grant all on public.webhook_events to service_role;
create function public.claim_webhook_event(p_id text)returns boolean language plpgsql security invoker set search_path='' as $$
declare result text;
begin
  insert into public.webhook_events as events(id,status)values(p_id,'processing') on conflict(id)do update set status='processing',updated_at=now() where events.status='failed' or(events.status='processing' and events.updated_at<now()-interval '5 minutes') returning id into result;
  return result is not null;
end $$;

-- Only the trusted web/worker service can mutate privileged records or execute queue/billing RPCs.
revoke all on function public.save_owned_record(text,uuid,uuid,jsonb),public.claim_agent_run(text,integer,integer),public.reserve_submission(uuid,uuid,integer),public.record_verified_submission(uuid,uuid),public.release_submission(uuid,uuid),public.consume_rate_limit(text,integer,integer),public.claim_webhook_event(text) from public,anon,authenticated;
grant execute on function public.save_owned_record(text,uuid,uuid,jsonb),public.claim_agent_run(text,integer,integer),public.reserve_submission(uuid,uuid,integer),public.record_verified_submission(uuid,uuid),public.release_submission(uuid,uuid),public.consume_rate_limit(text,integer,integer),public.claim_webhook_event(text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit)values('career-artifacts','career-artifacts',false,15728640)on conflict(id)do nothing;
create policy career_artifact_read on storage.objects for select to authenticated using(bucket_id='career-artifacts' and (storage.foldername(name))[1]=(select auth.uid())::text);
-- Artifact uploads are validated by server routes and written with the service role.

-- OAuth secrets live in Supabase Vault, never in ordinary application rows. The
-- private mapping keeps ownership separate from the encrypted Vault value.
create extension if not exists supabase_vault with schema vault;
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
grant usage on schema private to service_role;
create table private.integration_secrets(reference uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(id) on delete cascade,name text not null,vault_id uuid not null,unique(user_id,name));
alter table private.integration_secrets enable row level security;
revoke all on private.integration_secrets from public,anon,authenticated;
create function private.set_integration_secret(p_user_id uuid,p_name text,p_value text)returns uuid language plpgsql security definer set search_path='' as $$
declare secret_row private.integration_secrets;secret_id uuid;new_ref uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_name,0));
  select * into secret_row from private.integration_secrets where user_id=p_user_id and name=p_name;
  if secret_row.reference is not null then perform vault.update_secret(secret_row.vault_id,p_value);return secret_row.reference;end if;
  select vault.create_secret(p_value,'career:'||p_user_id::text||':'||p_name)into secret_id;
  insert into private.integration_secrets(user_id,name,vault_id)values(p_user_id,p_name,secret_id)returning reference into new_ref;return new_ref;
end $$;
create function private.get_integration_secret(p_user_id uuid,p_reference uuid)returns text language sql security definer set search_path='' as $$
  select secrets.decrypted_secret from private.integration_secrets as owner join vault.decrypted_secrets as secrets on secrets.id=owner.vault_id where owner.user_id=p_user_id and owner.reference=p_reference
$$;
create function private.delete_integration_secret(p_user_id uuid,p_reference uuid)returns void language plpgsql security definer set search_path='' as $$
declare secret_id uuid;
begin delete from private.integration_secrets where user_id=p_user_id and reference=p_reference returning vault_id into secret_id;if secret_id is not null then delete from vault.secrets where id=secret_id;end if;end $$;
create function private.purge_vault_secret()returns trigger language plpgsql security definer set search_path='' as $$begin delete from vault.secrets where id=old.vault_id;return old;end$$;
revoke all on function private.purge_vault_secret()from public,anon,authenticated;
create trigger purge_career_vault_secret after delete on private.integration_secrets for each row execute function private.purge_vault_secret();
revoke all on function private.set_integration_secret(uuid,text,text),private.get_integration_secret(uuid,uuid),private.delete_integration_secret(uuid,uuid) from public,anon,authenticated;
grant execute on function private.set_integration_secret(uuid,text,text),private.get_integration_secret(uuid,uuid),private.delete_integration_secret(uuid,uuid) to service_role;
create function public.set_integration_secret(p_user_id uuid,p_name text,p_value text)returns uuid language sql security invoker set search_path='' as $$select private.set_integration_secret(p_user_id,p_name,p_value)$$;
create function public.get_integration_secret(p_user_id uuid,p_reference uuid)returns text language sql security invoker set search_path='' as $$select private.get_integration_secret(p_user_id,p_reference)$$;
create function public.delete_integration_secret(p_user_id uuid,p_reference uuid)returns void language sql security invoker set search_path='' as $$select private.delete_integration_secret(p_user_id,p_reference)$$;
revoke all on function public.set_integration_secret(uuid,text,text),public.get_integration_secret(uuid,uuid),public.delete_integration_secret(uuid,uuid) from public,anon,authenticated;
grant execute on function public.set_integration_secret(uuid,text,text),public.get_integration_secret(uuid,uuid),public.delete_integration_secret(uuid,uuid) to service_role;
