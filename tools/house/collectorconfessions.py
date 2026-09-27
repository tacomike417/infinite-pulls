"""
COLLECTORCONFESSIONS -- the posting rule, agreed with Mike 27 Sep 2026.

  * 1 post every 3 days, at a random time between 6am and 11am Eastern.
    Mike: "these are conversational, so it gives people a chance to see
    them and comment" -- a new one does not bury the last one's replies.
  * Each post is one question card ("What card did you sell and
    immediately regret?") with a card photo on it. 30 in the first batch,
    picked at random, never repeated. Goes quiet when the queue runs out.
  * No caption: the question and its follow-up line are on the picture.
  * The card photos are eBay listing photos embedded in the layouts.
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

HERE = Path(__file__).parent / 'collectorconfessions'
ANCHOR = date(2026, 9, 28)          # first posting day; then every third day


def on_day(d):
    return (d - ANCHOR).days % 3 == 0


RULE = dict(n_min=1, n_max=1, start_h=6, end_h=11, gap_min=60, on_day=on_day)


def main():
    mode = (os.environ.get('HOUSE_MODE') or 'normal').strip().lower()
    email = os.environ.get('CONFESSIONS_EMAIL', 'collectorconfessions@infinitepulls.com')
    pw = os.environ.get('HOUSE_PASSWORD')
    if not pw:
        sys.exit('HOUSE_PASSWORD is not set (GitHub secret).')
    queue = json.loads((HERE / 'posts.json').read_text())

    house = House(email, pw)
    if mode != 'dry' and not house.rpc('house_is_active'):
        say('switched OFF on the master page -- not posting')
        return
    if mode == 'normal' and not should_post_now(house, 'collectorconfessions', RULE):
        say('nothing due right now')
        return

    posted = {r['card_id'] for r in house.log('2020-01-01T00:00:00+00:00') if r.get('card_id')}
    left = [p for p in queue if p['id'] not in posted]
    say(f'{len(left)} of {len(queue)} questions not posted yet')
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
                                         'caption': item.get('caption')})
    house.insert('house_post_log', {'account_id': house.uid, 'kind': 'confession',
                                    'card_id': item['id'],
                                    'photo_id': photo and photo.get('id')})
    say('POSTED', key)


if __name__ == '__main__':
    main()
