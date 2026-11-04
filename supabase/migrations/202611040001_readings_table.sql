-- Read-only, bounded raw telemetry pages. Ownership stays enforced by existing RLS.
create function public.table_readings(p_meters uuid[],p_start timestamptz,p_end timestamptz,p_before_time timestamptz default null,p_before_id bigint default null)
returns setof public.readings language plpgsql stable security invoker set search_path='' as $$
begin
 if p_meters is null or cardinality(p_meters) not between 1 and 32 or p_start is null or p_end is null or p_end<=p_start or p_end-p_start>interval '90 days'
   or (p_before_time is null)<>(p_before_id is null) then raise exception 'TABLE_LIMIT: choose 1–32 meters and at most 90 days'; end if;
 return query select * from public.readings r
 where r.meter_id=any(p_meters) and r.received_at>=p_start and r.received_at<p_end
 and (p_before_time is null or (r.received_at,r.id)<(p_before_time,p_before_id))
 order by r.received_at desc,r.id desc limit 51;
end $$;
revoke all on function public.table_readings(uuid[],timestamptz,timestamptz,timestamptz,bigint) from public,anon;
grant execute on function public.table_readings(uuid[],timestamptz,timestamptz,timestamptz,bigint) to authenticated;
