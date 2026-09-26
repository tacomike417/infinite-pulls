"""
TCGCARDWATCH -- the posting rule, agreed with Mike 26 Sep 2026.

  * 1-3 posts a day, random times between 8am and 11pm Eastern, never
    closer than 3 hours apart.
  * Each post is the week's biggest price mover (up or down) that has not
    been posted in the last 14 days: cards that STARTED at $10 or more and
    moved 10% or more over 7 days, from the same top_movers() the public
    Movers & Shakers board uses.
  * The card art goes on one of his backgrounds over the blue slot, with
    the headline, name, set, old price TO new price and @TCGCardWatch.
  * Nothing fresh to post? Skip it. Never repeat a card to fill a slot.
  * Switched OFF on the master page? Posts nothing.

Run modes (HOUSE_MODE):
  normal  -- the schedule decides (what the timer uses)
  force   -- post one right now, ignoring the schedule (for testing)
  dry     -- build today's picture and save it, post NOTHING
"""
import io
import os
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).parent))
from common import ET, House, fetch_bytes, say, should_post_now  # noqa: E402

HERE = Path(__file__).parent
ART = HERE / 'tcgcardwatch'
FONTS = HERE / 'fonts'

RULE = dict(n_min=1, n_max=3, start_h=8, end_h=23, gap_min=180)
MIN_START_PRICE = 10
MIN_MOVE_PCT = 10
NO_REPEAT_DAYS = 14

# The blue card slot in every background, measured on the 1122x1402 art.
SLOT = (305, 235, 816, 1025)
BACKGROUNDS = sorted(ART.glob('bg*.png')) + sorted(ART.glob('bg*.jpg'))


# ------------------------------------------------------------- picking
def pick_card(house):
    since = (datetime.now(ET) - timedelta(days=NO_REPEAT_DAYS)).isoformat()
    used = {r['card_id'] for r in house.log(since) if r.get('card_id')}
    pool = []
    for direction in ('up', 'down'):
        rows = house.rpc('top_movers', {'p_direction': direction, 'p_limit': 100, 'p_days': 7,
                                        'p_min_price': MIN_START_PRICE, 'p_max_pct': 400}) or []
        for r in rows:
            if abs(float(r['pct'])) >= MIN_MOVE_PCT and r['card_id'] not in used and r.get('image_base'):
                pool.append(dict(r, direction=direction))
    pool.sort(key=lambda r: -abs(float(r['pct'])))
    say(f'{len(pool)} fresh movers to choose from')
    return pool


def card_image(r):
    for size in ('high.png', 'high.webp', 'high.jpg'):
        try:
            return Image.open(io.BytesIO(fetch_bytes(r['image_base'].rstrip('/') + '/' + size))).convert('RGBA')
        except Exception:  # noqa: BLE001 -- try the next size, then give up on this card
            continue
    return None


# ------------------------------------------------------------ drawing
def compose(bg_path, card, r):
    im = Image.open(bg_path).convert('RGBA').resize((1122, 1402), Image.LANCZOS)
    W, _ = im.size
    cx, cy = (SLOT[0] + SLOT[2]) // 2, (SLOT[1] + SLOT[3]) // 2
    ch = int((SLOT[3] - SLOT[1]) * 1.04)
    cw = int(card.width * ch / card.height)
    c = card.resize((cw, ch), Image.LANCZOS)
    mask = Image.new('L', (cw, ch), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, cw, ch), radius=int(cw * 0.045), fill=255)
    c.putalpha(Image.composite(c.split()[3], Image.new('L', c.size, 0), mask))
    up = r['direction'] == 'up'
    rc = c.rotate(random.choice([-5, -4, -3]) if up else random.choice([3, 4, 5]),
                  expand=True, resample=Image.BICUBIC)
    sh = Image.new('RGBA', rc.size, (0, 0, 0, 0))
    sh.putalpha(rc.split()[3].point(lambda a: int(a * 0.75)))
    sh = sh.filter(ImageFilter.GaussianBlur(14))
    x, y = cx - rc.width // 2, cy - rc.height // 2
    im.alpha_composite(sh, (x + 18, y + 22))
    im.alpha_composite(rc, (x, y))

    d = ImageDraw.Draw(im)
    lg, an = str(FONTS / 'luckiest-guy.ttf'), str(FONTS / 'anton.ttf')

    def txt(s, font, size, ycenter, fill, stroke=10, rot=0):
        f = ImageFont.truetype(font, size)
        while d.textlength(s, font=f) > W - 60 and size > 20:
            size -= 2
            f = ImageFont.truetype(font, size)
        layer = Image.new('RGBA', (W, size * 2), (0, 0, 0, 0))
        ImageDraw.Draw(layer).text((W // 2, size), s, font=f, fill=fill, anchor='mm',
                                   stroke_width=stroke, stroke_fill='black')
        if rot:
            layer = layer.rotate(rot, resample=Image.BICUBIC)
        im.alpha_composite(layer, (0, ycenter - size))

    pct = abs(float(r['pct']))
    green, red = '#3dff5a', '#ff4b4b'
    txt(('UP %.1f%% THIS WEEK' if up else 'DOWN %.1f%% THIS WEEK') % pct, lg, 104, 128,
        green if up else red, 12, rot=2 if up else -2)
    txt((r.get('name') or 'Mystery Card').upper(), an, 72, 1090, 'white', 8)
    setline = ' · '.join(p for p in [r.get('set_name') or '', ('#' + r['number']) if r.get('number') else ''] if p)
    if setline:
        txt(setline, an, 40, 1150, '#ffe066', 6)
    txt('$%.2f  TO  $%.2f' % (float(r['then_price']), float(r['now_price'])), lg, 80, 1238,
        green if up else red, 10)
    txt('@TCGCardWatch', lg, 54, 1330, '#ffd400', 8)

    out = io.BytesIO()
    im.convert('RGB').resize((1080, 1350), Image.LANCZOS).save(out, 'JPEG', quality=88, optimize=True)
    return out.getvalue()


# ---------------------------------------------------------------- run
def main():
    mode = (os.environ.get('HOUSE_MODE') or 'normal').strip().lower()
    email = os.environ.get('TCGCARDWATCH_EMAIL', 'tcgcardwatch@infinitepulls.com')
    pw = os.environ.get('TCGCARDWATCH_PASSWORD')
    if not pw:
        sys.exit('TCGCARDWATCH_PASSWORD is not set (GitHub secret).')
    if not BACKGROUNDS:
        sys.exit('No backgrounds in tools/house/tcgcardwatch/.')

    house = House(email, pw)
    if mode != 'dry' and not house.rpc('house_is_active'):
        say('switched OFF on the master page -- not posting')
        return
    if mode == 'normal' and not should_post_now(house, 'tcgcardwatch', RULE):
        say('nothing due right now')
        return

    for r in pick_card(house):
        card = card_image(r)
        if card is None:
            say('no art for', r['name'], '-- trying the next one')
            continue
        jpg = compose(random.choice(BACKGROUNDS), card, r)
        say(f"picked {r['name']} ({r['direction']} {float(r['pct']):.1f}%)")
        if mode == 'dry':
            Path('house-preview.jpg').write_bytes(jpg)
            say('dry run: saved house-preview.jpg, posted nothing')
            return
        key = house.upload_photo(jpg, r['card_id'])
        photo = house.insert('user_photos', {'user_id': house.uid, 'object_key': key})
        house.insert('house_post_log', {'account_id': house.uid, 'kind': 'mover',
                                        'card_id': r['card_id'], 'direction': r['direction'],
                                        'photo_id': photo and photo.get('id')})
        say('POSTED', key)
        return
    say('no fresh mover with art -- skipping this post')


if __name__ == '__main__':
    main()
