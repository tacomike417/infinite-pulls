"""
HOUSE ACCOUNTS -- the pieces every house poster shares.

Each house account posts AS ITSELF: it signs in with its own email and
password (kept in a GitHub secret), uploads through the same photo worker
the app uses, and writes its post the same way a person does. No service
key, nothing that can touch anybody else's rows.

Only the standard library plus Pillow, so the GitHub Action needs one pip
install and nothing else.
"""
import hashlib
import json
import os
import random
import urllib.error
import urllib.request
from datetime import datetime, timedelta, time as dtime
from zoneinfo import ZoneInfo

# Public values -- the same ones in config.js. Nothing secret here.
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://rrkyvcouxdmurwdyuugv.supabase.co')
ANON_KEY = os.environ.get('SUPABASE_ANON_KEY', 'sb_publishable_SJEQDnQAEqCcIooFfDUjwg_jhYgUTe_')
PHOTO_BASE = os.environ.get('CARD_PHOTO_BASE', 'https://infinite-pulls-cards.mnasvadi.workers.dev')

ET = ZoneInfo('America/New_York')
UA = 'InfinitePulls-HouseAccounts/1.0'


def say(*a):
    print('[house]', *a, flush=True)


# ---------------------------------------------------------------- http
def _req(method, url, body=None, headers=None, raw=False, timeout=40):
    h = {'User-Agent': UA}
    h.update(headers or {})
    data = None
    if body is not None:
        if isinstance(body, (bytes, bytearray)):
            data = bytes(body)
        else:
            data = json.dumps(body).encode()
            h.setdefault('Content-Type', 'application/json')
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            out = r.read()
            return out if raw else (json.loads(out) if out else None)
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors='replace')[:500]
        raise RuntimeError(f'{method} {url.split("?")[0]} -> {e.code}: {msg}') from None


class House:
    """A signed-in house account."""

    def __init__(self, email, password):
        out = _req('POST', f'{SUPABASE_URL}/auth/v1/token?grant_type=password',
                   {'email': email, 'password': password}, {'apikey': ANON_KEY})
        self.token = out['access_token']
        self.uid = out['user']['id']
        say('signed in as', email)

    def h(self, extra=None):
        d = {'apikey': ANON_KEY, 'Authorization': 'Bearer ' + self.token}
        d.update(extra or {})
        return d

    def rpc(self, fn, args=None):
        return _req('POST', f'{SUPABASE_URL}/rest/v1/rpc/{fn}', args or {}, self.h())

    def select(self, table, query):
        return _req('GET', f'{SUPABASE_URL}/rest/v1/{table}?{query}', None, self.h())

    def insert(self, table, row):
        out = _req('POST', f'{SUPABASE_URL}/rest/v1/{table}', row,
                   self.h({'Prefer': 'return=representation'}))
        return out[0] if isinstance(out, list) and out else out

    def upload_photo(self, jpeg_bytes, card_id=''):
        url = f'{PHOTO_BASE}/upload?card=' + urllib.request.quote(card_id or '')
        out = _req('POST', url, jpeg_bytes, {'Authorization': 'Bearer ' + self.token,
                                             'Content-Type': 'image/jpeg'})
        if not out or not out.get('key'):
            raise RuntimeError('photo worker gave back no key')
        return out['key']

    def log(self, since_iso):
        return self.select('house_post_log',
                           'select=card_id,posted_at&account_id=eq.' + self.uid +
                           '&posted_at=gte.' + urllib.request.quote(since_iso) +
                           '&order=posted_at.desc')


def fetch_bytes(url, timeout=40):
    return _req('GET', url, raw=True, timeout=timeout)


# ------------------------------------------------------------ schedule
def day_slots(account_key, day, n_min, n_max, start_h, end_h, gap_min):
    """Random post times for one account on one day, the same every time
    they are worked out -- seeded from the account and the date, so the
    poster needs no table to remember its plan. Returns aware datetimes."""
    seed = int(hashlib.sha256(f'{account_key}|{day.isoformat()}'.encode()).hexdigest(), 16)
    rng = random.Random(seed)
    n = rng.randint(n_min, n_max)
    lo, hi = start_h * 60, end_h * 60
    for want in range(n, 0, -1):
        for _ in range(2000):
            mins = sorted(rng.randint(lo, hi) for _ in range(want))
            if all(b - a >= gap_min for a, b in zip(mins, mins[1:])):
                base = datetime.combine(day, dtime(0, 0), ET)
                return [base + timedelta(minutes=m) for m in mins]
    return []


def should_post_now(house, account_key, rule, now=None):
    """True when a planned slot has come due that has not been used yet,
    and the last post was at least the minimum gap ago."""
    now = now or datetime.now(ET)
    slots = day_slots(account_key, now.date(), rule['n_min'], rule['n_max'],
                      rule['start_h'], rule['end_h'], rule['gap_min'])
    due = [s for s in slots if s <= now]
    midnight = datetime.combine(now.date(), dtime(0, 0), ET)
    recent = house.log((now - timedelta(days=1)).isoformat())
    today = [r for r in recent if datetime.fromisoformat(r['posted_at']) >= midnight]
    say('today\'s plan:', ', '.join(s.strftime('%-I:%M %p') for s in slots) or 'none',
        f'| due {len(due)} | posted {len(today)}')
    if len(today) >= len(due):
        return False
    if recent:
        last = datetime.fromisoformat(recent[0]['posted_at'])
        if now - last < timedelta(minutes=rule['gap_min']):
            say('last post too recent, waiting')
            return False
    return True
