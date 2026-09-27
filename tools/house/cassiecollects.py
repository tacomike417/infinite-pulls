"""
CASSIECOLLECTS -- the posting rule, agreed with Mike 27 Sep 2026.

  * 1 post a day, two days on and one day off, at a random time between
    8am and 3am Eastern. (The window runs past midnight; see
    should_post_now in common.py. Never closer than 4 hours to her last.)
  * Each post is one card from her queue -- the photo plus her playful
    "which one would YOU keep?" note. 50 in the first batch, picked at
    random, never repeated. Goes quiet when the queue runs out.
  * The photos are eBay listing photos (links kept in posts.json as
    "source"); Cassie is a house character and never claims she owns,
    bought or photographed them.
  * Switched OFF on the master page? Posts nothing.

HOUSE_MODE: normal (schedule) / force (post one now) / dry (pick one, post nothing)
"""
import json
import os
import random
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import House, say, should_post_now  # noqa: E402

HERE = Path(__file__).parent / 'cassiecollects'
ANCHOR = date(2026, 9, 28)          # day 1 of the first two-on / one-off round


def on_day(d):
    """Two days on, one day off: the third day of every three is off."""
    return (d - ANCHOR).days % 3 != 2


RULE = dict(n_min=1, n_max=1, start_h=8, end_h=27, gap_min=240, on_day=on_day)


def main():
    mode = (os.environ.get('HOUSE_MODE') or 'normal').strip().lower()
    email = os.environ.get('CASSIE_EMAIL', 'cassiecollects@infinitepulls.com')
    pw = os.environ.get('HOUSE_PASSWORD')
    if not pw:
        sys.exit('HOUSE_PASSWORD is not set (GitHub secret).')
    queue = json.loads((HERE / 'posts.json').read_text())

    house = House(email, pw)
    if mode != 'dry' and not house.rpc('house_is_active'):
        say('switched OFF on the master page -- not posting')
        return
    if mode == 'normal' and not should_post_now(house, 'cassiecollects', RULE):
        say('nothing due right now')
        return

    posted = {r['card_id'] for r in house.log('2020-01-01T00:00:00+00:00') if r.get('card_id')}
    left = [p for p in queue if p['id'] not in posted]
    say(f'{len(left)} of {len(queue)} cards not posted yet')
    if not left:
        say('queue is empty -- add more posts')
        return
    item = random.choice(left)
    say('picked', item['title'])
    if mode == 'dry':
        say('dry run: posted nothing')
        return
    key = house.upload_photo((HERE / item['photo']).read_bytes(), item['id'][:40])
    photo = house.insert('user_photos', {'user_id': house.uid, 'object_key': key,
                                         'caption': item['caption']})
    house.insert('house_post_log', {'account_id': house.uid, 'kind': 'cassie',
                                    'card_id': item['id'],
                                    'photo_id': photo and photo.get('id')})
    say('POSTED', key)


if __name__ == '__main__':
    main()
