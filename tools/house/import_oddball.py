"""
Bring ChatGPT's oddball zips into oddballemon's queue.

    python3 tools/house/import_oddball.py ~/Downloads/Infinite-pulls-feed-wakeup/*.zip

Each zip holds an *index*.csv (title, caption, photo_file) and photos/.
Every post is keyed by its TITLE, so running this again is safe:
  * a title already in the queue keeps its photo and takes the NEWER
    caption (that is how a "(1)" re-wording zip updates the posts),
  * a new title is added,
  * nothing is ever removed, and a posted item is never posted twice
    (the poster remembers what it posted in house_post_log).
Zips are read oldest-first, so the newest wording always wins.
Photos are shrunk to 1200px JPEGs so the repo stays small.
"""
import csv
import io
import json
import re
import sys
import zipfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent / 'oddballemon'
PHOTOS = HERE / 'photos'
QUEUE = HERE / 'posts.json'
MAX_DIM = 1200


def slug(s):
    s = s.lower().replace('é', 'e')
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')[:70]


def main(paths):
    PHOTOS.mkdir(parents=True, exist_ok=True)
    queue = json.loads(QUEUE.read_text()) if QUEUE.exists() else []
    by_id = {p['id']: p for p in queue}
    added = updated = 0
    zips = sorted((Path(p) for p in paths), key=lambda p: p.stat().st_mtime)
    for zp in zips:
        with zipfile.ZipFile(zp) as z:
            names = z.namelist()
            index = next((n for n in names if n.endswith('.csv') and 'index' in n.lower()), None)
            if not index:
                print(f'skip {zp.name}: no index csv')
                continue
            root = index.rsplit('/', 1)[0] + '/' if '/' in index else ''
            rows = list(csv.DictReader(io.TextIOWrapper(z.open(index), encoding='utf-8')))
            for r in rows:
                title, caption = (r.get('title') or '').strip(), (r.get('caption') or '').strip()
                if not title or not caption:
                    continue
                pid = slug(title)
                if pid in by_id:
                    if by_id[pid]['caption'] != caption:
                        by_id[pid]['caption'] = caption
                        updated += 1
                    continue
                photo_name = root + (r.get('photo_file') or '').strip()
                if photo_name not in names:
                    print(f'  no photo for "{title}" in {zp.name} -- skipped')
                    continue
                im = Image.open(io.BytesIO(z.read(photo_name))).convert('RGB')
                im.thumbnail((MAX_DIM, MAX_DIM), Image.LANCZOS)
                im.save(PHOTOS / f'{pid}.jpg', 'JPEG', quality=85, optimize=True)
                item = {'id': pid, 'title': title, 'caption': caption, 'photo': f'photos/{pid}.jpg'}
                queue.append(item)
                by_id[pid] = item
                added += 1
        print(f'read {zp.name}')
    QUEUE.write_text(json.dumps(queue, indent=1, ensure_ascii=False))
    print(f'done: {added} added, {updated} re-worded, {len(queue)} in the queue')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
