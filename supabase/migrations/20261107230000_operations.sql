-- Operational state that belongs to no tenant. Only the trusted web/worker service reads or
-- writes it; it contains no customer data.
create table public.worker_heartbeats (
  worker_id text primary key check (length(worker_id) between 1 and 200),
  started_at timestamptz not null,
  beat_at timestamptz not null default now(),
  lanes integer not null check (lanes between 1 and 20),
  busy integer not null default 0 check (busy >= 0),
  version text check (version is null or length(version) <= 100)
);
alter table public.worker_heartbeats enable row level security;
revoke all on public.worker_heartbeats from anon,authenticated;
grant all on public.worker_heartbeats to service_role;

-- Retention for operational records. Tenant data is removed by account deletion; this prunes
-- expired rate-limit windows, settled webhook claims, and departed workers.
create function public.prune_operational_records(p_webhook_days integer default 90)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare limits integer; events integer; workers integer;
begin
  delete from public.rate_limits where expires_at < now() - interval '1 day';
  get diagnostics limits = row_count;
  delete from public.webhook_events where status = 'processed'
    and updated_at < now() - make_interval(days => greatest(30, least(p_webhook_days, 3650)));
  get diagnostics events = row_count;
  delete from public.worker_heartbeats where beat_at < now() - interval '7 days';
  get diagnostics workers = row_count;
  return jsonb_build_object('rate_limits', limits, 'webhook_events', events, 'worker_heartbeats', workers);
end $$;
revoke all on function public.prune_operational_records(integer) from public,anon,authenticated;
grant execute on function public.prune_operational_records(integer) to service_role;
