-- Rainfall tracker schema.
--
-- rain_periods holds one row per Yr time step for each town. Rows from the
-- current hour onward are replaced on every fetch. Once an hour has passed its
-- row is never touched again, so the last estimate for that hour becomes the
-- record. That one rule is what turns a forecast feed into a rainfall history.

create table public.towns (
  id                  bigint generated always as identity primary key,
  name                text not null check (length(trim(name)) > 0),
  province            text not null default '',
  lat                 numeric(7,4) not null check (lat between -90 and 90),
  lon                 numeric(7,4) not null check (lon between -180 and 180),
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  -- Collector bookkeeping, needed for Yr's caching rules.
  next_fetch_at       timestamptz not null default now(),
  last_modified       text,
  forecast_updated_at timestamptz,
  last_success_at     timestamptz,
  last_error          text,
  unique (lat, lon)
);

create index towns_due_idx on public.towns (next_fetch_at) where active;

create table public.rain_periods (
  town_id             bigint not null references public.towns (id) on delete cascade,
  valid_from          timestamptz not null,
  hours               smallint not null default 1 check (hours between 1 and 12),
  mm                  numeric(7,3) not null check (mm >= 0),
  forecast_updated_at timestamptz,
  primary key (town_id, valid_from)
);

create table public.collector_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  due         int not null default 0,
  updated     int not null default 0,
  unchanged   int not null default 0,
  failed      int not null default 0,
  note        text
);

-- Saves one town's forecast in a single transaction.
create function public.save_forecast(
  p_town_id             bigint,
  p_rows                jsonb,
  p_forecast_updated_at timestamptz,
  p_last_modified       text,
  p_next_fetch_at       timestamptz,
  p_now                 timestamptz default now()
) returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_hour  timestamptz := date_trunc('hour', p_now);
  v_first timestamptz;
  v_count int := 0;
begin
  select min((r->>'valid_from')::timestamptz) into v_first
  from jsonb_array_elements(p_rows) r
  where (r->>'valid_from')::timestamptz >= v_hour;

  if v_first is not null then
    delete from public.rain_periods
    where town_id = p_town_id and valid_from >= v_first;

    -- A multi-hour row left from before an outage may overlap the new rows.
    -- Keep only the part before them, so no rain is counted twice.
    update public.rain_periods p
    set mm    = p.mm * (extract(epoch from v_first - p.valid_from) / 3600) / p.hours,
        hours = (extract(epoch from v_first - p.valid_from) / 3600)::smallint
    where p.town_id = p_town_id
      and p.valid_from < v_first
      and p.valid_from + make_interval(hours => p.hours) > v_first;

    insert into public.rain_periods (town_id, valid_from, hours, mm, forecast_updated_at)
    select p_town_id,
           (r->>'valid_from')::timestamptz,
           (r->>'hours')::smallint,
           (r->>'mm')::numeric,
           p_forecast_updated_at
    from jsonb_array_elements(p_rows) r
    where (r->>'valid_from')::timestamptz >= v_hour;

    get diagnostics v_count = row_count;
  end if;

  update public.towns
  set next_fetch_at       = p_next_fetch_at,
      last_modified       = p_last_modified,
      forecast_updated_at = p_forecast_updated_at,
      last_success_at     = p_now,
      last_error          = null
  where id = p_town_id;

  return v_count;
end;
$$;

revoke all on function public.save_forecast(bigint, jsonb, timestamptz, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.save_forecast(bigint, jsonb, timestamptz, text, timestamptz, timestamptz)
  to service_role;

-- One row per hour. Six-hour forecast blocks are split evenly across their hours.
create view public.rain_hourly with (security_invoker = true) as
select r.town_id,
       r.valid_from + make_interval(hours => g.n) as hour,
       (r.mm / r.hours)::numeric(7,3) as mm,
       r.valid_from + make_interval(hours => g.n) < date_trunc('hour', now()) as is_past
from public.rain_periods r
cross join lateral generate_series(0, r.hours - 1) as g(n);

-- Daily totals, using South African days rather than UTC days.
create view public.rain_daily with (security_invoker = true) as
select town_id,
       (hour at time zone 'Africa/Johannesburg')::date as day,
       sum(mm)::numeric(8,2) as mm,
       count(*) filter (where is_past)::int as past_hours,
       count(*)::int as hours
from public.rain_hourly
group by 1, 2;

-- One row per town with a total for each dashboard period. The hours_* columns
-- say how much of the period was really tracked, so a young town or an outage
-- shows up as a partial total rather than as a dry spell.
create view public.town_summary with (security_invoker = true) as
with clock as (
  select date_trunc('hour', now()) as h,
         local.month_start at time zone 'Africa/Johannesburg' as month_start,
         make_date(
           case when extract(month from local.ts) >= 7
                then extract(year from local.ts)::int
                else extract(year from local.ts)::int - 1 end,
           7, 1)::timestamp at time zone 'Africa/Johannesburg' as season_start
  from (
    select now() at time zone 'Africa/Johannesburg' as ts,
           date_trunc('month', now() at time zone 'Africa/Johannesburg') as month_start
  ) local
),
totals as (
  select r.town_id,
    coalesce(sum(r.mm) filter (where r.hour >= c.h - interval '24 hours' and r.hour < c.h), 0) as mm_24h,
    count(*) filter (where r.hour >= c.h - interval '24 hours' and r.hour < c.h) as hours_24h,
    coalesce(sum(r.mm) filter (where r.hour >= c.h - interval '7 days' and r.hour < c.h), 0) as mm_7d,
    count(*) filter (where r.hour >= c.h - interval '7 days' and r.hour < c.h) as hours_7d,
    coalesce(sum(r.mm) filter (where r.hour >= c.h - interval '30 days' and r.hour < c.h), 0) as mm_30d,
    count(*) filter (where r.hour >= c.h - interval '30 days' and r.hour < c.h) as hours_30d,
    coalesce(sum(r.mm) filter (where r.hour >= c.month_start and r.hour < c.h), 0) as mm_month,
    count(*) filter (where r.hour >= c.month_start and r.hour < c.h) as hours_month,
    coalesce(sum(r.mm) filter (where r.hour >= c.season_start and r.hour < c.h), 0) as mm_season,
    count(*) filter (where r.hour >= c.season_start and r.hour < c.h) as hours_season,
    coalesce(sum(r.mm) filter (where r.hour >= c.h and r.hour < c.h + interval '24 hours'), 0) as next_24h,
    coalesce(sum(r.mm) filter (where r.hour >= c.h and r.hour < c.h + interval '7 days'), 0) as next_7d,
    min(r.hour) as tracking_since
  from public.rain_hourly r
  cross join clock c
  where r.hour >= least(c.season_start, c.h - interval '30 days')
  group by r.town_id
)
select t.id, t.name, t.province, t.lat, t.lon,
       t.last_success_at, t.forecast_updated_at, t.last_error,
       coalesce(x.mm_24h, 0)::numeric(8,1)    as mm_24h,    coalesce(x.hours_24h, 0)::int    as hours_24h,
       coalesce(x.mm_7d, 0)::numeric(8,1)     as mm_7d,     coalesce(x.hours_7d, 0)::int     as hours_7d,
       coalesce(x.mm_30d, 0)::numeric(8,1)    as mm_30d,    coalesce(x.hours_30d, 0)::int    as hours_30d,
       coalesce(x.mm_month, 0)::numeric(8,1)  as mm_month,  coalesce(x.hours_month, 0)::int  as hours_month,
       coalesce(x.mm_season, 0)::numeric(8,1) as mm_season, coalesce(x.hours_season, 0)::int as hours_season,
       coalesce(x.next_24h, 0)::numeric(8,1)  as next_24h,
       coalesce(x.next_7d, 0)::numeric(8,1)   as next_7d,
       x.tracking_since,
       (extract(epoch from c.h - c.month_start) / 3600)::int  as expected_hours_month,
       (extract(epoch from c.h - c.season_start) / 3600)::int as expected_hours_season
from public.towns t
cross join clock c
left join totals x on x.town_id = t.id
where t.active;

-- The website may read rainfall. Only the Edge Functions, which use the secret
-- key, may write.
alter table public.towns          enable row level security;
alter table public.rain_periods   enable row level security;
alter table public.collector_runs enable row level security;

create policy "Anyone can read towns" on public.towns
  for select to anon, authenticated using (true);
create policy "Anyone can read rainfall" on public.rain_periods
  for select to anon, authenticated using (true);

revoke all on public.towns, public.rain_periods, public.collector_runs from anon, authenticated;
grant select on public.towns, public.rain_periods to anon, authenticated;
grant select on public.rain_hourly, public.rain_daily, public.town_summary to anon, authenticated;
grant all on public.towns, public.rain_periods, public.collector_runs to service_role;
grant select on public.rain_hourly, public.rain_daily, public.town_summary to service_role;
