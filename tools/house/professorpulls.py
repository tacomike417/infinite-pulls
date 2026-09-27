"""
PROFESSOR PULLS -- the posting rule, agreed with Mike 26 Sep 2026.

  * 1 post a day, at a random time between 6am and 8am Eastern.
  * Each post is one graded slab from the queue (photo + his deadpan
    "official assessment"), picked at random from the ones not posted yet.
    100 in the first batch, so about three months of mornings.
  * Never repeats. When the queue runs out, it stops posting until more
    are added.
  * The photos are eBay listing photos, not his cards -- Mike's call to
    post them anyway (26 Sep 2026). Each item keeps its listing link in
    posts.json as "source".
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

HERE = Path(__file__).parent / 'professorpulls'
RULE = dict(n_min=1, n_max=1, start_h=6, end_h=8, gap_min=120)


def main():
    mode = (os.environ.get('HOUSE_MODE') or 'normal').strip().lower()
    email = os.environ.get('PROFESSORPULLS_EMAIL', 'professorpulls@infinitepulls.com')
    pw = os.environ.get('HOUSE_PASSWORD')
    if not pw:
        sys.exit('HOUSE_PASSWORD is not set (GitHub secret).')
    queue = json.loads((HERE / 'posts.json').read_text())

    house = House(email, pw)
    if mode != 'dry' and not house.rpc('house_is_active'):
        say('switched OFF on the master page -- not posting')
        return
    if mode == 'normal' and not should_post_now(house, 'professorpulls', RULE):
        say('nothing due right now')
        return

    posted = {r['card_id'] for r in house.log('2020-01-01T00:00:00+00:00') if r.get('card_id')}
    left = [p for p in queue if p['id'] not in posted]
    say(f'{len(left)} of {len(queue)} slabs not posted yet')
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
    house.insert('house_post_log', {'account_id': house.uid, 'kind': 'professor',
                                    'card_id': item['id'],
                                    'photo_id': photo and photo.get('id')})
    say('POSTED', key)


if __name__ == '__main__':
    main()
