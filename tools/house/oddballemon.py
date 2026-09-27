"""
ODDBALLEMON -- the posting rule, agreed with Mike 26 Sep 2026.

  * 1-2 posts a day, random times between 9am and 5pm Eastern, never
    closer than 2 hours apart.
  * Each post is one oddball find from the queue (photo + caption, written
    by ChatGPT and brought in by import_oddball.py), picked at random from
    the ones not posted yet.
  * Never repeats. When the queue runs out, it stops posting until more
    zips are imported.
  * Switched OFF on the master page? Posts nothing.

HOUSE_MODE: normal (schedule) / force (post one now) / dry (pick one, post nothing)
"""
import json
import os
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import House, say, should_post_now  # noqa: E402

HERE = Path(__file__).parent / 'oddballemon'
RULE = dict(n_min=1, n_max=2, start_h=9, end_h=17, gap_min=120)


def main():
    mode = (os.environ.get('HOUSE_MODE') or 'normal').strip().lower()
    email = os.environ.get('ODDBALLEMON_EMAIL', 'oddballemon@infinitepulls.com')
    pw = os.environ.get('HOUSE_PASSWORD')
    if not pw:
        sys.exit('HOUSE_PASSWORD is not set (GitHub secret).')
    queue = json.loads((HERE / 'posts.json').read_text())

    house = House(email, pw)
    if mode != 'dry' and not house.rpc('house_is_active'):
        say('switched OFF on the master page -- not posting')
        return
    if mode == 'normal' and not should_post_now(house, 'oddballemon', RULE):
        say('nothing due right now')
        return

    posted = {r['card_id'] for r in house.log('2020-01-01T00:00:00+00:00') if r.get('card_id')}
    left = [p for p in queue if p['id'] not in posted]
    say(f'{len(left)} of {len(queue)} oddballs not posted yet')
    if not left:
        say('queue is empty -- import more zips')
        return
    item = random.choice(left)
    say('picked', item['title'])
    if mode == 'dry':
        say('dry run: posted nothing')
        return
    key = house.upload_photo((HERE / item['photo']).read_bytes(), 'oddball-' + item['id'][:40])
    photo = house.insert('user_photos', {'user_id': house.uid, 'object_key': key,
                                         'caption': item['caption']})
    house.insert('house_post_log', {'account_id': house.uid, 'kind': 'oddball',
                                    'card_id': item['id'],
                                    'photo_id': photo and photo.get('id')})
    say('POSTED', key)


if __name__ == '__main__':
    main()
