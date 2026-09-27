"""
DANSPOKEMONFINDS -- the posting rule, agreed with Mike 27 Sep 2026.

  * 1-2 posts a night, random times between 8pm and 2am Eastern, never
    closer than 15 minutes apart. (The window runs past midnight; see
    should_post_now in common.py.)
  * Each post is one physical Pokemon oddity -- bootleg toys and fan-made
    objects -- as a curator note: what it is, then a dry joke. 200 in the
    first batch, picked at random, never repeated. Goes quiet when the
    queue runs out.
  * The photos belong to the makers and sellers (their links are kept in
    posts.json as "source"); Dan's notes never claim he found or owns them.
  * The account was CantonCollector; the username is danspokemonfinds now
    but the login email did not change -- DANS_EMAIL overrides it.

HOUSE_MODE: normal (schedule) / force (post one now) / dry (pick one, post nothing)
"""
import json
import os
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import House, say, should_post_now  # noqa: E402

HERE = Path(__file__).parent / 'danspokemonfinds'
RULE = dict(n_min=1, n_max=2, start_h=20, end_h=26, gap_min=15)


def main():
    mode = (os.environ.get('HOUSE_MODE') or 'normal').strip().lower()
    email = os.environ.get('DANS_EMAIL', 'cantoncollector@infinitepulls.com')
    pw = os.environ.get('HOUSE_PASSWORD')
    if not pw:
        sys.exit('HOUSE_PASSWORD is not set (GitHub secret).')
    queue = json.loads((HERE / 'posts.json').read_text())

    house = House(email, pw)
    if mode != 'dry' and not house.rpc('house_is_active'):
        say('switched OFF on the master page -- not posting')
        return
    if mode == 'normal' and not should_post_now(house, 'danspokemonfinds', RULE):
        say('nothing due right now')
        return

    posted = {r['card_id'] for r in house.log('2020-01-01T00:00:00+00:00') if r.get('card_id')}
    left = [p for p in queue if p['id'] not in posted]
    say(f'{len(left)} of {len(queue)} oddities not posted yet')
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
    house.insert('house_post_log', {'account_id': house.uid, 'kind': 'dan',
                                    'card_id': item['id'],
                                    'photo_id': photo and photo.get('id')})
    say('POSTED', key)


if __name__ == '__main__':
    main()
