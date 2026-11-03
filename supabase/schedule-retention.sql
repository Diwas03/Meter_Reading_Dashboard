-- Run once in the intended project's SQL editor after enabling pg_cron.
-- DELETES expired raw readings, at most 5,000 every ten minutes.
-- Re-running does not duplicate this named job.
select cron.schedule('meter-retention', '*/10 * * * *', 'select public.cleanup_readings();');
-- Configure retention (admin only):
-- update public.retention_settings set days=30 where singleton;
-- Disable automatic deletion: select cron.unschedule('meter-retention');
