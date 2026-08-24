# Generates stand-in card photos for tools/ocr-check.mjs.
#
# Not real Pokemon cards — card-SHAPED images with the same things in the
# same places: a name across the top, busy artwork in the middle, body
# text below it, and the number printed small in the bottom-left corner.
# Then made to look like a snapshot rather than a scan: sitting on a
# textured background with a margin around it, slightly rotated, slightly
# blurred. That last part is the point — a pipeline that only works on a
# perfect flat scan is not a scanner anybody can use at a counter.
#
# The four cases are the ones that actually break naive OCR:
#   clean   - the easy baseline
#   secret  - number ABOVE the set total (199/165), which real secret
#             rares do and which an over-clever sanity check will reject
#   dark    - white number on a dark strip, so the image has to be
#             inverted before it can be read
#   tilted  - photographed at an angle, with a wide margin
#
# Run: python3 tools/make-test-cards.py
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import random, os, glob

import pathlib
OUT = str(pathlib.Path(__file__).resolve().parent / 'test-cards')
os.makedirs(OUT, exist_ok=True)
random.seed(7)

def font(sz):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()

# A stand-in for a photo of a card: card-shaped, busy "artwork" in the
# middle, a name across the top, and the number printed small in the
# bottom-left corner the way a modern Pokemon card does it — sitting on a
# photo background, slightly rotated, slightly blurred, like a real snap.
def make(name, number, total, path, dark_corner=False, rotate=0, blur=0.6, margin=90):
    W, H = 734, 1024
    card = Image.new('RGB', (W, H), (245, 240, 225))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle([8,8,W-8,H-8], radius=28, fill=(252,214,88), outline=(190,150,40), width=6)
    # art box with noise, so OCR has something to be distracted by
    art = Image.new('RGB', (W-120, 420))
    ap = art.load()
    for y in range(art.height):
        for x in range(art.width):
            ap[x,y] = (random.randint(20,200), random.randint(40,190), random.randint(60,210))
    art = art.filter(ImageFilter.GaussianBlur(6))
    card.paste(art, (60, 150))
    d.rectangle([60,150,W-60,570], outline=(120,90,20), width=5)
    d.text((60, 70), name, font=font(52), fill=(20,20,20))
    d.text((W-190, 78), "HP 330", font=font(34), fill=(180,30,30))
    # body text block, the stuff that used to confuse the old name reader
    d.text((66, 610), "Ability  Infernal Reign", font=font(30), fill=(30,30,30))
    d.text((66, 655), "When you play this Pokemon from your hand to", font=font(24), fill=(60,60,60))
    d.text((66, 685), "evolve 1 of your Pokemon, you may search your", font=font(24), fill=(60,60,60))
    d.text((66, 760), "Burning Darkness            180+", font=font(30), fill=(30,30,30))

    # the corner: light strip by default, dark on some cards
    strip_y = H - 90
    if dark_corner:
        d.rectangle([0, strip_y-16, W, H-8], fill=(28,28,34))
        num_fill = (240,240,240)
    else:
        num_fill = (35,35,35)
    d.text((44, strip_y), f"{number}/{total}", font=font(30), fill=num_fill)
    d.text((W-230, strip_y), "Illus. 5ban", font=font(22), fill=num_fill)

    # make it a photo: background, rotation, blur, slight exposure shift
    bg = Image.new('RGB', (W+margin*2, H+margin*2), (52, 58, 66))
    bp = bg.load()
    for y in range(0, bg.height, 3):
        for x in range(0, bg.width, 3):
            v = random.randint(-12, 12)
            c = bp[x,y]
            bp[x,y] = tuple(max(0,min(255,ch+v)) for ch in c)
    if rotate:
        card = card.rotate(rotate, expand=True, fillcolor=(52,58,66), resample=Image.BICUBIC)
    bg.paste(card, ((bg.width-card.width)//2, (bg.height-card.height)//2))
    bg = bg.filter(ImageFilter.GaussianBlur(blur))
    bg.save(path, quality=88)

cases = [
    ("Charizard ex",  "066", "108", "clean.jpg",   False, 0,    0.5, 90),
    ("Charizard ex",  "199", "165", "secret.jpg",  False, -1.5, 0.8, 120),
    ("Pikachu",       "025", "091", "dark.jpg",    True,  1.2,  0.7, 70),
    ("Iron Valiant",  "004", "162", "tilted.jpg",  False, 3.0,  0.9, 140),
]
for name, num, tot, fn, dark, rot, blur, marg in cases:
    make(name, num, tot, f"{OUT}/{fn}", dark, rot, blur, marg)
    print("made", fn, f"{num}/{tot}")

# ---- Guided captures ------------------------------------------------
# What the in-page framing guide hands to the reader: the card and nothing
# else, straight on. No table, no fingers, no rotation. These are what
# GUIDED_NUMBER_REGIONS is measured against, and the difference between
# these and the snapshots above is the whole reason the guide exists.
def make_guided(name, number, total, path, dark_corner=False, blur=0.4):
    W, H = 734, 1024
    card = Image.new('RGB', (W, H), (245, 240, 225))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle([8,8,W-8,H-8], radius=28, fill=(252,214,88), outline=(190,150,40), width=6)
    art = Image.new('RGB', (W-120, 420))
    ap = art.load()
    for y in range(art.height):
        for x in range(art.width):
            ap[x,y] = (random.randint(20,200), random.randint(40,190), random.randint(60,210))
    art = art.filter(ImageFilter.GaussianBlur(6))
    card.paste(art, (60, 150))
    d.rectangle([60,150,W-60,570], outline=(120,90,20), width=5)
    d.text((60, 70), name, font=font(52), fill=(20,20,20))
    d.text((W-190, 78), "HP 330", font=font(34), fill=(180,30,30))
    d.text((66, 610), "Ability  Infernal Reign", font=font(30), fill=(30,30,30))
    d.text((66, 655), "When you play this Pokemon from your hand to", font=font(24), fill=(60,60,60))
    d.text((66, 760), "Burning Darkness            180+", font=font(30), fill=(30,30,30))
    strip_y = H - 90
    if dark_corner:
        d.rectangle([0, strip_y-16, W, H-8], fill=(28,28,34))
        num_fill = (240,240,240)
    else:
        num_fill = (35,35,35)
    d.text((44, strip_y), f"{number}/{total}", font=font(30), fill=num_fill)
    d.text((W-230, strip_y), "Illus. 5ban", font=font(22), fill=num_fill)
    card = card.filter(ImageFilter.GaussianBlur(blur))
    card.save(path, quality=90)

guided = [
    ("Charizard ex", "066", "108", "guided-clean.jpg",  False, 0.4),
    ("Charizard ex", "199", "165", "guided-secret.jpg", False, 0.6),
    ("Pikachu",      "025", "091", "guided-dark.jpg",   True,  0.5),
]
for name, num, tot, fn, dark, blur in guided:
    make_guided(name, num, tot, f"{OUT}/{fn}", dark, blur)
    print("made", fn, f"{num}/{tot}")
