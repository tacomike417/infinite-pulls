-- Infinite Pulls — connect Clover with a merchant API token
-- ========================================================
--
-- WHY THIS EXISTS
--
-- The Clover integration was built around OAuth: register a developer
-- account, create an app, get a client id and secret, send the shop
-- through an authorise screen. That is the right shape for an app many
-- shops install. It is also blocked on a developer account that has not
-- been approved.
--
-- There is a second door, and for this situation it is the better one.
-- A Clover merchant can mint an API token for their OWN data straight from
-- their dashboard -- Settings -> API tokens -- with no developer account
-- and no app. Clover's own words for what it is for: "internal tools or
-- integrations where you control both the application and the merchant
-- environment". That is exactly this. Jeff owns the shop; this is his app.
--
-- WHY IT IS BETTER THAN THE LOGIN HE OFFERED
--
-- A token is scoped -- this one can read and write inventory and nothing
-- else. It cannot see payments, customers or staff. Jeff can revoke it
-- from that same screen without changing his password or locking himself
-- out of his own till. A shared login has none of those properties.
--
-- WHAT THIS DOES NOT CHANGE
--
-- Nothing about where the token lives. clover_connection already has RLS
-- on and no policies at all, so the token is unreachable over the API by
-- anybody; only the edge functions, running with the service role, ever
-- read it. This just adds a staff-only way to PUT one there.
--
-- SAFE TO RUN TWICE.

create or replace function public.clover_save_merchant_token(
  p_merchant_id text,
  p_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mid text := btrim(coalesce(p_merchant_id, ''));
  v_tok text := btrim(coalesce(p_token, ''));
begin
  if not public.is_shop_staff() then
    raise exception 'Only shop staff can connect Clover.';
  end if;

  -- Empty either box means disconnect, rather than saving a broken
  -- half-connection that fails confusingly at sync time.
  if v_mid = '' or v_tok = '' then
    update public.clover_connection
       set access_token = null,
           refresh_token = null,
           access_token_expires_at = null,
           connected = false,
           last_sync_error = null
     where id = 1;
    return;
  end if;

  /* A merchant token never expires and has no refresh token, so both are
     left null ON PURPOSE. The edge functions read that pair as "this is a
     static token, use it as it is" -- see the note in
     sync-clover-inventory. */
  update public.clover_connection
     set merchant_id = v_mid,
         access_token = v_tok,
         refresh_token = null,
         access_token_expires_at = null,
         connected = true,
         last_sync_error = null
   where id = 1;
end;
$$;

revoke all on function public.clover_save_merchant_token(text, text) from anon;
grant execute on function public.clover_save_merchant_token(text, text) to authenticated;


-- The status the admin panel reads, now able to say WHICH kind of
-- connection is in place -- so the panel can stop telling somebody to
-- finish an OAuth flow they are not using.
drop function if exists public.clover_connection_status();
create or replace function public.clover_connection_status()
returns table (
  connected boolean,
  merchant_id text,
  last_synced_at timestamptz,
  last_sync_error text,
  has_credentials boolean,
  token_kind text
)
language sql
security definer
set search_path = public
stable
as $$
  select connected, merchant_id, last_synced_at, last_sync_error,
         (client_id is not null and client_secret is not null) as has_credentials,
         case
           when access_token is null then 'none'
           when refresh_token is null then 'merchant'   -- static, from his dashboard
           else 'oauth'
         end as token_kind
  from public.clover_connection where id = 1;
$$;

grant execute on function public.clover_connection_status() to authenticated;

comment on function public.clover_save_merchant_token(text, text) is
  'Staff-only. Stores a Clover merchant API token (from the shop dashboard, Settings -> API tokens) plus the merchant id. Leaves refresh_token and expiry null, which is how the edge functions recognise a non-expiring token.';
