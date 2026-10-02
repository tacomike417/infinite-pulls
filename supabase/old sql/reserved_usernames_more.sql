-- ============================================================
-- RESERVED USERNAMES, ROUND TWO -- 25 Sep 2026 (SOCIAL-NEXT part 1)
--
-- usernames.sql already made the one list, made names unique whatever
-- the capitals, and made the database the gate. This adds the names that
-- came along since: the /retailer/ and /privacy/ folders, the card-art,
-- dex-art and jeff-photos folders, every way of spelling the shop or
-- Jeff or Hyde-Bot, and the brand names nobody gets to wear.
--
-- Mike's rule: "we got to protect ourselves" -- this comes BEFORE any
-- @handle push.
--
-- SAFE TO RUN TWICE. Replacing the list does not re-check existing rows
-- (Postgres only checks a constraint on the rows being written), so the
-- guard below does it by hand and changes nothing if an existing account
-- already holds one of the new names.
-- ============================================================

do $$
declare
  taken text;
begin
  select string_agg(username, ', ') into taken
    from public.profiles
   where lower(username) in ('admin', 'assets', 'components', 'supabase', 'api', 'tools', 'data', 'pulls', 'infinite-questions', 'feed-next', 'brand-kit', 'cf-worker', 'stress-test', 'node_modules', 'icons', 'functions', 'retailer', 'privacy', 'card-art', 'dex-art', 'jeff-photos', 'home', 'shop', 'collection', 'pokedex', 'dex', 'goals', 'events', 'deals', 'lookup', 'location', 'hours', 'contact', 'about', 'account', 'menu', 'gallery', 'item', 'thanks', 'movers', 'mine', 'wishlist', 'post', 'search', 'feed', 'profile', 'www', 'null', 'undefined', 'favicon', 'index', 'readme', 'cname', 'app', 'style', 'config', 'manifest', 'service-worker', 'robots', 'sitemap', '404', 'static', 'infinitepulls', 'infinite-pulls', 'infinite_pulls', 'infinite', 'official', 'staff', 'support', 'help', 'team', 'moderator', 'mod', 'owner', 'administrator', 'jeff', 'jeffhyde', 'jeff-hyde', 'hyde', 'hydebot', 'hyde-bot', 'store', 'live', 'verified', 'security', 'billing', 'system', 'root', 'me', 'you', 'everyone', 'pokemon', 'pokemontcg', 'tcgplayer', 'whatnot');
  if taken is not null then
    raise exception E'These existing usernames would become reserved, so nothing was changed:\n  %\nDecide what to do with them first, then run this again.', taken;
  end if;
end $$;

create or replace function public.is_reserved_username(name text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(name, '')) in (
    -- real folders in the repository
    'admin','assets','components','supabase','api','tools','data','pulls',
    'infinite-questions','feed-next','brand-kit','cf-worker','stress-test',
    'node_modules','icons','functions','retailer','privacy','card-art',
    'dex-art','jeff-photos',
    -- routes the app answers on
    'home','shop','collection','pokedex','dex','goals','events','deals',
    'lookup','location','hours','contact','about','account','menu',
    'gallery','item','thanks','movers','mine','wishlist','post','search',
    'feed','profile',
    -- files and conventions at the root
    'www','null','undefined','favicon','index','readme','cname','app',
    'style','config','manifest','service-worker','robots','sitemap','404',
    'static',
    -- things that would read as the shop itself
    'infinitepulls','infinite-pulls','infinite_pulls','infinite','official',
    'staff','support','help','team','moderator','mod','owner',
    'administrator','jeff','jeffhyde','jeff-hyde','hyde','hydebot',
    'hyde-bot','store','live','verified','security','billing','system',
    'root','me','you','everyone',
    -- brand names nobody gets to wear
    'pokemon','pokemontcg','tcgplayer','whatnot'
  );
$$;

-- Proof it took: every one of these should say true.
select n as name, public.is_reserved_username(n) as reserved
  from unnest(array['retailer','Jeffhyde','INFINITE-PULLS','pokemon','hyde-bot','whatnot']) as n;
