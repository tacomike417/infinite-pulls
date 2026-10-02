-- NO PHOTOS IN MESSAGES (28 Sep 2026, Jeff). The database itself refuses
-- any message with a photo, whatever sends it. Safe to run twice.
alter table public.dm_messages drop constraint if exists dm_no_photos;
alter table public.dm_messages add constraint dm_no_photos check (photo_key is null) not valid;
select 'no photos: ok' as status;
