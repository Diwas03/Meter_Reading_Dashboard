# Free-plan sizing, retention and query cost

Checked against current official Supabase documentation on 2026-11-03. Confirm the dashboard's Usage page before expanding an installation; limits can change and other projects/services in the organization share relevant quotas.

| Resource | Free allowance documented | Design response |
|---|---|---|
| PostgreSQL database | 500 MB per project | 30-day raw retention, bounded cleanup, monitor actual table/index size |
| Egress | 5 GB/month | Server-side chart buckets, bounded CSV, 60s refresh, no subscriptions |
| Edge invocations | 500,000/month | Batch up to four firmware samples; one-minute sampling |
| Monthly active Auth users | 50,000 | Email/password accounts and per-owner RLS |
| Free projects | 2 across owned/administered organizations | Use the newly created Free project; no paid upgrade |

Object Storage's 1 GB allowance does not extend the 500 MB database allowance; this system does not use object storage. Inactivity can pause Free projects; uptime, backups and quota behaviour should be checked in the current Free terms. A paused/read-only/full project is an explicit offline/error condition, not a reason to upgrade automatically.

## Approximate data budget

One meter at 60s = **1,440 rows/day**, **43,200 rows/30 days**. With sixteen `float8` columns (128B), three UUIDs (48B), identity/timestamps/clock flag/JSON errors plus heap overhead/alignment, assume **280–420B heap per normal row**. Four B-tree indexes (primary identity, gateway/sample unique, meter/time/identity, retention/time/identity), page slack and overhead add roughly **200–280B/row**. A practical starting estimate is **500–700B per sample**, or **21.6–30.2 MB per meter / 30 days**, excluding Auth/system tables, WAL, temporary space, dead tuples and unusually large errors.

Budget at least **1 KB/sample** for failure-heavy periods/bloat: **43.2 MB/meter/30 days**. Eight meters can therefore consume roughly **173–346 MB** at 30 days before other database use. Do not assume the 500 MB ceiling permits a precise number of meters; reserve headroom and measure. A payload with 16 maximal 120-character diagnostics is much larger than a healthy sample. Default unavailable errors are short, but large diagnostics reduce capacity.

One gateway uploading once/minute ≈43,200 invocations/30 days. Eight samples can be sent in two four-sample batches ≈86,400 invocations/30 days (assuming queue accumulates a poll; exact scheduling may split smaller batches). 32m batching at one gateway is a backend capability; firmware caps the bus at eight. Multiple gateways, retries and unauthenticated abuse also consume invocations. 500k is not unlimited capacity.

Chart responses are limited to about 880 bucket/meter combinations plus boundary rows, roughly a few hundred KB uncompressed at maximum selection. A dashboard left open continuously can still use significant egress (43,200 refreshes/month); narrow selections, avoid always-open unnecessary sessions, and monitor Usage. CSV is on-demand only. Refresh intervals are deliberately 60s and do not create a realtime stream.

Measure database use in the SQL editor:

```sql
select pg_size_pretty(pg_total_relation_size('public.readings')) as readings_with_indexes,
       pg_size_pretty(pg_relation_size('public.readings')) as heap,
       pg_size_pretty(pg_indexes_size('public.readings')) as indexes;
select count(*) as rows, min(received_at), max(received_at) from public.readings;
select days from public.retention_settings;
```

Retention uses server received time. The SQL migration creates the 30-day setting and `cleanup_readings()`; **activation of pg_cron and `supabase/schedule-retention.sql` is a separate account step**. Each ten-minute run deletes at most 5,000 old rows with `SKIP LOCKED`, allowing normal ingestion to proceed. Cleanup has tested multiple-batch behaviour, but the actual hosted schedule must be verified through `cron.job_run_details`. PostgreSQL autovacuum reuses deleted space; it does not immediately shrink allocated disk. Do not run `VACUUM FULL` automatically. Longer retention or many meters requires tighter monitoring, lower retention/frequency, or a separately considered hosting decision—never an automatic paid upgrade.
