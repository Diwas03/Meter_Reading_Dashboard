\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,msg text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',msg; end if; end $$;
insert into auth.users values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select public.manage_device('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','register',null,'Gateway A',array[1,2],repeat('a',64)) as a \gset
select public.manage_device('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','register',null,'Gateway B',array[1],repeat('b',64)) as b \gset
select set_config('test.a',:'a',true),set_config('test.b',:'b',true);
select set_config('test.b_meter',(select id::text from public.meters where device_id=:'b'),true);
select public.ingest_samples(:'a',repeat('a',64),'[{"sample_id":"11111111-1111-4111-8111-111111111111","slave_id":1,"measured_at":null,"values":{"frequency":0},"errors":{"current_r":"timeout"}}]');
select pg_temp.assert((select frequency=0 and current_r is null and clock_source='server' from public.readings where device_id=:'a'),'zero, null and clock fallback');
update public.device_credentials set last_request_at=null;
select pg_temp.assert((public.ingest_samples(:'a',repeat('a',64),'[{"sample_id":"11111111-1111-4111-8111-111111111111","slave_id":1,"values":{"frequency":99}}]')->>'duplicates')::int=1,'retry dedup');
select pg_temp.assert((select frequency=0 from public.readings where device_id=:'a'),'duplicate must not overwrite');
update public.device_credentials set last_request_at=null;
select public.ingest_samples(:'b',repeat('b',64),'[{"sample_id":"11111111-1111-4111-8111-111111111111","slave_id":1,"values":{"frequency":50}}]');
select pg_temp.assert((select count(*)=2 from public.readings),'same sample ID on different gateways allowed');
update public.device_credentials set last_request_at=null;
select public.ingest_samples(:'a',repeat('a',64),'[{"sample_id":"22222222-2222-4222-8222-222222222222","slave_id":2,"values":{"frequency":49}}]');
select pg_temp.assert((select count(distinct meter_id)=3 from public.readings),'multiple gateway/meter separation');
do $$ begin
 begin perform public.ingest_samples(current_setting('test.a')::uuid,repeat('b',64),'[]');raise exception 'FAIL bad token';exception when others then if sqlerrm not like '%UNAUTHORIZED%' then raise;end if;end;
 begin perform public.ingest_samples(current_setting('test.a')::uuid,repeat('a',64),'[]');raise exception 'FAIL rate limit';exception when others then if sqlerrm not like '%RATE_LIMIT%' then raise;end if;end;
 update public.device_credentials set last_request_at=null;
 begin perform public.ingest_samples(current_setting('test.a')::uuid,repeat('a',64),'[{"sample_id":"33333333-3333-4333-8333-333333333333","slave_id":3,"values":{}}]');raise exception 'FAIL meter isolation';exception when others then if sqlerrm not like '%UNREGISTERED_METER%' then raise;end if;end;
 begin perform public.manage_device('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','rotate',current_setting('test.b')::uuid,null,'{}',repeat('c',64));raise exception 'FAIL cross-owner manage';exception when others then if sqlerrm not like '%FORBIDDEN%' then raise;end if;end;
end $$;
select public.manage_device('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','rotate',:'a',null,'{}',repeat('c',64));
do $$ begin
 begin perform public.ingest_samples(current_setting('test.a')::uuid,repeat('a',64),'[]');raise exception 'FAIL old token';exception when others then if sqlerrm not like '%UNAUTHORIZED%' then raise;end if;end;
end $$;
update public.device_credentials set last_request_at=null;
select public.ingest_samples(:'a',repeat('c',64),'[{"sample_id":"44444444-4444-4444-8444-444444444444","slave_id":1,"values":{"frequency":50}}]');
select public.manage_device('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','revoke',:'a',null,'{}',null);
do $$ begin
 begin perform public.ingest_samples(current_setting('test.a')::uuid,repeat('c',64),'[]');raise exception 'FAIL revoked token';exception when others then if sqlerrm not like '%UNAUTHORIZED%' then raise;end if;end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
select pg_temp.assert((select count(*)=1 from public.devices),'owner device isolation');
select pg_temp.assert((select count(*)=2 from public.meters),'owner meter isolation');
select pg_temp.assert((select count(*)=3 from public.readings),'owner reading isolation');
select pg_temp.assert((select count(*)=2 from public.latest_readings(array(select id from public.meters))),'latest per meter');
select pg_temp.assert((select count(*)=3 from public.export_readings(array(select id from public.meters),now()-interval '1 hour',now()+interval '1 hour',null,null)),'bounded CSV query');
select pg_temp.assert((select count(*)=0 from public.export_readings(array(select id from public.meters),now()-interval '1 hour',now()+interval '1 hour','2100-01-01',0)),'CSV keyset cursor');
select pg_temp.assert((select count(*)>0 from public.chart_readings(array(select id from public.meters),now()-interval '1 hour',now()+interval '1 hour',300) where frequency is null),'chart gaps preserved');
select pg_temp.assert((select count(*)>0 from public.chart_readings(array(select id from public.meters),now()-interval '1 hour',now()+interval '1 hour',300) where frequency is not null),'chart aggregates');
-- Attack other owner's UUIDs explicitly, not just a filtered device list.
select pg_temp.assert((select count(*)=0 from public.latest_readings(array[current_setting('test.b_meter')::uuid])),'cross-user latest UUID');
select pg_temp.assert((select count(*)=0 from public.chart_readings(array[current_setting('test.b_meter')::uuid],now()-interval '1 hour',now(),300)),'cross-user chart UUID');
select pg_temp.assert((select count(*)=0 from public.export_readings(array[current_setting('test.b_meter')::uuid],now()-interval '1 hour',now(),null,null)),'cross-user export UUID');
select pg_temp.assert((select count(*)=0 from public.latest_readings(array['99999999-9999-4999-8999-999999999999'::uuid])),'unknown latest meter');
do $$ begin
 begin insert into public.readings(sample_id,device_id,meter_id,clock_source) values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'server');raise exception 'FAIL browser write';exception when insufficient_privilege then null;end;
 begin perform public.ingest_samples(gen_random_uuid(),'x','[]');raise exception 'FAIL browser RPC write';exception when insufficient_privilege then null;end;
 begin perform public.manage_device(gen_random_uuid(),'register',null,'X',array[1],repeat('a',64));raise exception 'FAIL browser provision RPC';exception when insufficient_privilege then null;end;
 begin perform public.cleanup_readings();raise exception 'FAIL browser cleanup';exception when insufficient_privilege then null;end;
 begin perform * from public.device_credentials;raise exception 'FAIL credential leak';exception when insufficient_privilege then null;end;
 begin perform public.export_readings(array(select id from public.meters),now()-interval '8 days',now(),null,null);raise exception 'FAIL CSV bound';exception when others then if sqlerrm not like '%CSV_LIMIT%' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
select pg_temp.assert((select count(*)=1 from public.readings),'second owner isolation');
reset role;
set local role anon;
do $$ begin
 begin perform * from public.devices;raise exception 'FAIL anonymous select';exception when insufficient_privilege then null;end;
 begin perform public.latest_readings('{}');raise exception 'FAIL anonymous RPC';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Raw-table paging uses a stable descending (received_at,id) cursor, including tied timestamps.
savepoint table_paging;
insert into public.readings(sample_id,device_id,meter_id,received_at,clock_source,frequency)
select gen_random_uuid(),m.device_id,m.id,now()-interval '5 minutes','server',0
from public.meters m cross join generate_series(1,120) where m.device_id=:'a' and m.slave_id=1;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
select pg_temp.assert((select count(*)=51 from public.table_readings(array(select id from public.meters),now()-interval '10 minutes',now(),null,null)),'raw-table page limit');
select set_config('test.table_cursor',(select id::text from public.table_readings(array(select id from public.meters),now()-interval '10 minutes',now(),null,null) order by received_at desc,id desc offset 49 limit 1),true);
select pg_temp.assert((select count(*)=51 and max(id)<current_setting('test.table_cursor')::bigint from public.table_readings(array(select id from public.meters),now()-interval '10 minutes',now(),now()-interval '5 minutes',current_setting('test.table_cursor')::bigint)),'raw-table cursor tie handling');
select pg_temp.assert((select count(*)=0 from public.table_readings(array[current_setting('test.b_meter')::uuid],now()-interval '10 minutes',now(),null,null)),'raw-table cross-user isolation');
select pg_temp.assert((select count(*)=0 from public.table_readings(array(select id from public.meters),now()-interval '4 minutes',now(),null,null)),'raw-table logging-time filter');
do $$ begin
 begin perform public.table_readings(array(select id from public.meters),now()-interval '91 days',now(),null,null);raise exception 'FAIL raw-table range';exception when others then if sqlerrm not like '%TABLE_LIMIT%' then raise;end if;end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform public.table_readings('{}',now()-interval '1 day',now(),null,null);raise exception 'FAIL raw-table anonymous';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback to savepoint table_paging;
-- Retention deletes old rows only, bounded to 5,000 per call.
insert into public.readings(sample_id,device_id,meter_id,received_at,clock_source)
select gen_random_uuid(),m.device_id,m.id,now()-interval '31 days','server' from public.meters m cross join generate_series(1,1700);
select pg_temp.assert(public.cleanup_readings()=5000,'bounded retention batch');
select pg_temp.assert(public.cleanup_readings()=100,'remaining retention batch');
select pg_temp.assert((select count(*)=4 from public.readings),'retains recent rows');
rollback;
\echo 'PASS: SQL ownership, grants, credentials, rate limits, retries, multi-meter queries, gaps, export, retention'
