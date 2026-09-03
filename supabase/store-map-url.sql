-- The directions link. Run once, in the Supabase SQL Editor.
--
-- store_info is a single row holding one jsonb blob, so this sets the one key
-- and leaves every other field exactly as it is -- jsonb_set, not a rewrite.
--
-- Google's universal format: opens the Maps app on a phone and the website on
-- a desktop, pinned to the shop. It replaces "#", which is a link to nowhere
-- and made "Get Directions" a button that twitched the page and did nothing.

update public.store_info
   set data = jsonb_set(
         data,
         '{mapUrl}',
         '"https://www.google.com/maps/search/?api=1&query=4229+4th+St+NW,+Canton,+OH+44708"'::jsonb,
         true
       ),
       updated_at = now()
 where id = 1;

-- What you should see: the real link, and the rest of the shop details intact.
select data->>'mapUrl' as map_url,
       data->>'address' as address,
       data->>'phone'   as phone
  from public.store_info where id = 1;
