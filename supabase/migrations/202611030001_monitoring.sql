-- All browser access is authenticated and read-only. Writes go through validated Edge Functions.
create table public.devices (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null check (length(name) between 1 and 80),
 revoked_at timestamptz,
 created_at timestamptz not null default now()
);
create index devices_owner on public.devices(owner_id);
create table public.meters (
 id uuid primary key default gen_random_uuid(),
 device_id uuid not null references public.devices(id) on delete cascade,
 slave_id smallint not null check (slave_id between 1 and 247),
 unique(device_id,slave_id), unique(id,device_id)
);
create table public.device_credentials (
 device_id uuid primary key references public.devices(id) on delete cascade,
 token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
 rotated_at timestamptz not null default now(), last_request_at timestamptz
);
create table public.readings (
 id bigint generated always as identity primary key,
 sample_id uuid not null,
 device_id uuid not null references public.devices(id) on delete cascade,
 meter_id uuid not null,
 measured_at timestamptz,
 received_at timestamptz not null default clock_timestamp(),
 clock_source text not null check(clock_source in ('device','server')),
 errors jsonb not null default '{}' check(jsonb_typeof(errors) = 'object'),
 voltage_rn double precision check (voltage_rn between -1e9 and 1e9),
  voltage_yn double precision check (voltage_yn between -1e9 and 1e9),
  voltage_bn double precision check (voltage_bn between -1e9 and 1e9),
  voltage_avg double precision check (voltage_avg between -1e9 and 1e9),
  voltage_ry double precision check (voltage_ry between -1e9 and 1e9),
  voltage_yb double precision check (voltage_yb between -1e9 and 1e9),
  voltage_br double precision check (voltage_br between -1e9 and 1e9),
  current_r double precision check (current_r between -1e9 and 1e9),
  current_y double precision check (current_y between -1e9 and 1e9),
  current_b double precision check (current_b between -1e9 and 1e9),
  current_n double precision check (current_n between -1e9 and 1e9),
  pf_r double precision check (pf_r between -1e9 and 1e9),
  pf_y double precision check (pf_y between -1e9 and 1e9),
  pf_b double precision check (pf_b between -1e9 and 1e9),
  pf_avg double precision check (pf_avg between -1e9 and 1e9),
  frequency double precision check (frequency between -1e9 and 1e9),
 foreign key(meter_id,device_id) references public.meters(id,device_id) on delete cascade,
 unique(device_id,sample_id)
);
create index readings_meter_time on public.readings(meter_id,received_at desc,id desc);
create index readings_retention on public.readings(received_at,id);
create table public.retention_settings (
 singleton boolean primary key default true check(singleton),
 days integer not null default 30 check(days between 1 and 90)
);
insert into public.retention_settings(singleton,days) values(true,30);

alter table public.devices enable row level security;
alter table public.meters enable row level security;
alter table public.readings enable row level security;
alter table public.device_credentials enable row level security;
alter table public.retention_settings enable row level security;
revoke all on public.devices, public.meters, public.readings, public.device_credentials, public.retention_settings from public, anon, authenticated;
grant select on public.devices, public.meters, public.readings to authenticated;
grant all on public.devices, public.meters, public.readings, public.device_credentials, public.retention_settings to service_role;
revoke all on sequence public.readings_id_seq from public,anon,authenticated;
grant usage,select on sequence public.readings_id_seq to service_role;
create policy own_devices on public.devices for select to authenticated using(owner_id = (select auth.uid()));
create policy own_meters on public.meters for select to authenticated using(exists(select 1 from public.devices d where d.id=device_id and d.owner_id=(select auth.uid())));
create policy own_readings on public.readings for select to authenticated using(exists(select 1 from public.devices d where d.id=device_id and d.owner_id=(select auth.uid())));

create function public.manage_device(p_owner uuid,p_action text,p_device uuid,p_name text,p_slaves integer[],p_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_device uuid; v_slave integer;
begin
 -- Serialize per-owner provisioning so concurrent calls cannot bypass caps.
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 if p_action = 'register' then
   if (select count(*) from public.devices where owner_id=p_owner)>=20 then raise exception 'LIMIT'; end if;
   if cardinality(p_slaves) not between 1 and 32 then raise exception 'LIMIT'; end if;
   insert into public.devices(owner_id,name) values(p_owner,p_name) returning id into v_device;
   insert into public.device_credentials(device_id,token_hash) values(v_device,p_hash);
 else
   select id into v_device from public.devices where id=p_device and owner_id=p_owner for update;
   if v_device is null then raise exception 'FORBIDDEN'; end if;
 end if;
 if p_action in ('register','add_meters') then
   foreach v_slave in array p_slaves loop
     insert into public.meters(device_id,slave_id) values(v_device,v_slave) on conflict(device_id,slave_id) do nothing;
   end loop;
   if (select count(*) from public.meters where device_id=v_device)>32 then raise exception 'LIMIT'; end if;
 elsif p_action = 'rotate' then
   update public.device_credentials set token_hash=p_hash, rotated_at=clock_timestamp() where device_id=v_device;
   update public.devices set revoked_at=null where id=v_device;
 elsif p_action = 'revoke' then
   update public.devices set revoked_at=clock_timestamp() where id=v_device;
 else raise exception 'UNKNOWN_ACTION';
 end if;
 return v_device;
end $$;
revoke all on function public.manage_device(uuid,text,uuid,text,integer[],text) from public,anon,authenticated;
grant execute on function public.manage_device(uuid,text,uuid,text,integer[],text) to service_role;

create function public.ingest_samples(p_device uuid,p_hash text,p_samples jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cred public.device_credentials; s jsonb; v_meter uuid; n integer=0; wrote integer; v_now timestamptz=clock_timestamp();
begin
 -- Lock device first, same order as rotate/revoke: no revoked-token race.
 perform 1 from public.devices where id=p_device and revoked_at is null for update;
 if not found then raise exception 'UNAUTHORIZED'; end if;
 select * into cred from public.device_credentials where device_id=p_device for update;
 if not found or cred.token_hash <> p_hash or p_hash is null then raise exception 'UNAUTHORIZED'; end if;
 if cred.last_request_at > v_now-interval '10 seconds' then raise exception 'RATE_LIMIT'; end if;
 if jsonb_typeof(p_samples)<>'array' or jsonb_array_length(p_samples) not between 1 and 32 then raise exception 'INVALID_BATCH'; end if;
 for s in select * from jsonb_array_elements(p_samples) loop
   select id into v_meter from public.meters where device_id=p_device and slave_id=(s->>'slave_id')::integer;
   if v_meter is null then raise exception 'UNREGISTERED_METER'; end if;
   if (s->>'measured_at')::timestamptz < v_now-interval '7 days' or (s->>'measured_at')::timestamptz > v_now+interval '5 minutes' then raise exception 'INVALID_TIME'; end if;
   insert into public.readings(sample_id,device_id,meter_id,measured_at,clock_source,errors,voltage_rn,voltage_yn,voltage_bn,voltage_avg,voltage_ry,voltage_yb,voltage_br,current_r,current_y,current_b,current_n,pf_r,pf_y,pf_b,pf_avg,frequency)
   values((s->>'sample_id')::uuid,p_device,v_meter,(s->>'measured_at')::timestamptz,
     case when s->>'measured_at' is null then 'server' else 'device' end,coalesce(s->'errors','{}'),(s->'values'->>'voltage_rn')::double precision, (s->'values'->>'voltage_yn')::double precision, (s->'values'->>'voltage_bn')::double precision, (s->'values'->>'voltage_avg')::double precision, (s->'values'->>'voltage_ry')::double precision, (s->'values'->>'voltage_yb')::double precision, (s->'values'->>'voltage_br')::double precision, (s->'values'->>'current_r')::double precision, (s->'values'->>'current_y')::double precision, (s->'values'->>'current_b')::double precision, (s->'values'->>'current_n')::double precision, (s->'values'->>'pf_r')::double precision, (s->'values'->>'pf_y')::double precision, (s->'values'->>'pf_b')::double precision, (s->'values'->>'pf_avg')::double precision, (s->'values'->>'frequency')::double precision)
   on conflict(device_id,sample_id) do nothing;
   get diagnostics wrote = row_count; n=n+wrote;
 end loop;
 update public.device_credentials set last_request_at=v_now where device_id=p_device;
 return jsonb_build_object('inserted',n,'duplicates',jsonb_array_length(p_samples)-n,'received_at',v_now);
end $$;
revoke all on function public.ingest_samples(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_samples(uuid,text,jsonb) to service_role;

-- Security invoker means RLS applies to every chart, latest query and CSV page.
create function public.latest_readings(p_meters uuid[]) returns setof public.readings
language sql stable security invoker set search_path='' as $$
 select r.* from public.meters m cross join lateral (
   select * from public.readings r where r.meter_id=m.id order by received_at desc,id desc limit 1
 ) r where m.id=any(p_meters) and cardinality(p_meters)<=32
$$;
revoke all on function public.latest_readings(uuid[]) from public,anon;
grant execute on function public.latest_readings(uuid[]) to authenticated;

create function public.chart_readings(p_meters uuid[],p_start timestamptz,p_end timestamptz,p_seconds integer)
returns table(meter_id uuid,"time" timestamptz,voltage_rn double precision,voltage_yn double precision,voltage_bn double precision,voltage_avg double precision,voltage_ry double precision,voltage_yb double precision,voltage_br double precision,current_r double precision,current_y double precision,current_b double precision,current_n double precision,pf_r double precision,pf_y double precision,pf_b double precision,pf_avg double precision,frequency double precision)
language plpgsql stable security invoker set search_path='' as $$
begin
 if p_seconds not in (60,300,900,3600,21600,86400) or p_end<=p_start or p_end-p_start>interval '90 days' or cardinality(p_meters) not between 1 and 32
   or extract(epoch from p_end-p_start)/p_seconds*cardinality(p_meters)>950 then raise exception 'QUERY_LIMIT: choose coarser buckets'; end if;
 return query
 with buckets as (
   select generate_series(date_bin(make_interval(secs=>p_seconds),p_start,'2000-01-01'::timestamptz),p_end,make_interval(secs=>p_seconds)) as t
 ), selected as (select id from public.meters where id=any(p_meters)),
 agg as (
   select r.meter_id as mid,date_bin(make_interval(secs=>p_seconds),r.received_at,'2000-01-01'::timestamptz) as t,avg(r.voltage_rn) as voltage_rn,avg(r.voltage_yn) as voltage_yn,avg(r.voltage_bn) as voltage_bn,avg(r.voltage_avg) as voltage_avg,avg(r.voltage_ry) as voltage_ry,avg(r.voltage_yb) as voltage_yb,avg(r.voltage_br) as voltage_br,avg(r.current_r) as current_r,avg(r.current_y) as current_y,avg(r.current_b) as current_b,avg(r.current_n) as current_n,avg(r.pf_r) as pf_r,avg(r.pf_y) as pf_y,avg(r.pf_b) as pf_b,avg(r.pf_avg) as pf_avg,avg(r.frequency) as frequency
   from public.readings r where r.meter_id=any(p_meters) and r.received_at>=p_start and r.received_at<p_end group by 1,2
 )
 select selected.id,b.t,a.voltage_rn,a.voltage_yn,a.voltage_bn,a.voltage_avg,a.voltage_ry,a.voltage_yb,a.voltage_br,a.current_r,a.current_y,a.current_b,a.current_n,a.pf_r,a.pf_y,a.pf_b,a.pf_avg,a.frequency from selected cross join buckets b left join agg a on a.mid=selected.id and a.t=b.t order by b.t,selected.id;
end $$;
revoke all on function public.chart_readings(uuid[],timestamptz,timestamptz,integer) from public,anon;
grant execute on function public.chart_readings(uuid[],timestamptz,timestamptz,integer) to authenticated;

create function public.export_readings(p_meters uuid[],p_start timestamptz,p_end timestamptz,p_after_time timestamptz,p_after_id bigint)
returns setof public.readings language plpgsql stable security invoker set search_path='' as $$
begin
 if cardinality(p_meters) not between 1 and 32 or p_end<=p_start or p_end-p_start>interval '7 days' then raise exception 'CSV_LIMIT: select at most seven days'; end if;
 return query select * from public.readings r where r.meter_id=any(p_meters) and r.received_at>=p_start and r.received_at<p_end
 and (p_after_time is null or (r.received_at,r.id)>(p_after_time,p_after_id)) order by r.received_at,r.id limit 500;
end $$;
revoke all on function public.export_readings(uuid[],timestamptz,timestamptz,timestamptz,bigint) from public,anon;
grant execute on function public.export_readings(uuid[],timestamptz,timestamptz,timestamptz,bigint) to authenticated;

-- Bounded deletion; never expose cleanup or retention settings to browser roles.
create function public.cleanup_readings() returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 delete from public.readings where id in (select id from public.readings where received_at<now()-make_interval(days=>(select days from public.retention_settings where singleton)) order by received_at,id limit 5000 for update skip locked);
 get diagnostics n=row_count; return n;
end $$;
revoke all on function public.cleanup_readings() from public,anon,authenticated;
grant execute on function public.cleanup_readings() to service_role;
