#!/usr/bin/env python3
"""UPLOAD THE INFINITE PULLS TV LOOPS (4 Oct 2026, Mike).

Looks in ~/Downloads/infinite pulls loops (or the folder you name) for crazy-j-NN-*.mp4, seat-NN-*.mp4, pulls-news-NN-*.mp4 and
collector-in-the-wild-NN-*.mp4 (loose, or inside the zips), and sends each one ONCE,
straight to the video host. The house-loops function then posts one from each show every
day from @InfinitePullsTCG. Safe to run again: a Loop that already went up is skipped, a
broken file is skipped and named, and a remade file dropped in the folder later goes up
the next time you run it.

It needs the upload password. The paste command makes one and keeps it in
~/.infinite-pulls-house-key on this computer; it is never written down in the project.
"""
import base64, glob, json, os, re, struct, sys, time, zlib, urllib.request, urllib.error

FN = "https://rrkyvcouxdmurwdyuugv.functions.supabase.co/house-loops"
TUS = "https://video.bunnycdn.com/tusupload"
KEYFILE = os.path.expanduser("~/.infinite-pulls-house-key")
KEY = os.environ.get("HOUSE_KEY", "") or (open(KEYFILE).read().strip() if os.path.exists(KEYFILE) else "")
FOLDER = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Downloads/infinite pulls loops")

TAIL = " Infinite Pulls TV. \U0001F4FA"
SHOWS = [  # (file prefix, first number, what the caption starts with)
    ("crazy-j", 1000, "CRAZY J: "),
    ("seat", 1100, "A SEAT AT THE TABLE: "),          # 5 Oct: Crazy J takes his seat. Part of the Crazy J show (9am), after the first batch.
    ("pulls-news", 2000, "PULLS NEWS: "),
    ("collector-in-the-wild", 3000, "THE COLLECTOR, IN THE WILD: "),
]
NAME = re.compile(r"^(crazy-j|seat|pulls-news|collector-in-the-wild)-(\d{2})-([a-z0-9-]+)\.mp4$")
COVER_MS = {"seat": 13500}      # the still shown before it plays: the end card ("WE'RE TAKING OUR SEAT AT THE TABLE."), not the punchline


def call(body):
    req = urllib.request.Request(FN, data=json.dumps(dict(body, key=KEY)).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode() or "{}")
        except Exception:
            return {"ok": False, "error": "server said %s" % e.code}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def b64(s):
    return base64.b64encode(s.encode()).decode()


def tus_upload(data, slot, title):
    auth = {"AuthorizationSignature": slot["signature"], "AuthorizationExpire": str(slot["expire"]),
            "VideoId": slot["guid"], "LibraryId": str(slot["library"]), "Tus-Resumable": "1.0.0"}
    h = dict(auth)
    h["Upload-Length"] = str(len(data))
    h["Upload-Metadata"] = "filetype %s,title %s" % (b64("video/mp4"), b64(title))
    with urllib.request.urlopen(urllib.request.Request(TUS, data=b"", headers=h, method="POST"), timeout=60) as r:
        loc = r.headers.get("Location")
    if not loc:
        raise RuntimeError("the video host gave no upload address")
    if loc.startswith("/"):
        loc = "https://video.bunnycdn.com" + loc
    h = dict(auth)
    h["Upload-Offset"] = "0"
    h["Content-Type"] = "application/offset+octet-stream"
    with urllib.request.urlopen(urllib.request.Request(loc, data=data, headers=h, method="PATCH"), timeout=600) as r:
        got = int(r.headers.get("Upload-Offset") or 0)
    if got != len(data):
        raise RuntimeError("only %s of %s bytes arrived" % (got, len(data)))


def zip_members(path):
    """Every file in a zip, read from the front. Works even when the zip's index at the end is
    missing (some of the ChatGPT zips came down that way). A file that fails its check is dropped."""
    d = open(path, "rb").read()
    offs = [m.start() for m in re.finditer(b"PK\x03\x04", d)]
    for i, o in enumerate(offs):
        try:
            _, _, _, comp, _, _, crc, cs, _, nl, el = struct.unpack("<IHHHHHIIIHH", d[o:o + 30])
            name = os.path.basename(d[o + 30:o + 30 + nl].decode("utf8", "replace"))
            start = o + 30 + nl + el
            raw = d[start:start + cs] if cs else d[start:(offs[i + 1] if i + 1 < len(offs) else len(d))]
            data = raw if comp == 0 else zlib.decompressobj(-15).decompress(raw)
            good = bool(crc) and (zlib.crc32(data) & 0xFFFFFFFF) == crc
        except Exception:
            continue
        yield name, data, good


def whole(data):
    """A playable mp4 has its index ('moov') and is not tiny."""
    return len(data) > 500000 and b"moov" in data and b"ftyp" in data[:64]


def gather():
    found, broken = {}, set()
    def take(name, data, good=True):
        if not NAME.match(name):
            return
        if good and whole(data):
            found[name] = data
        elif name not in found:
            broken.add(name)
    for z in sorted(glob.glob(os.path.join(FOLDER, "*.zip"))):
        for name, data, good in zip_members(z):
            take(name, data, good)
    for f in sorted(glob.glob(os.path.join(FOLDER, "*.mp4"))):      # loose files win: that's where remakes go
        take(os.path.basename(f), open(f, "rb").read())
    return found, sorted(broken - set(found))


def main():
    if not KEY:
        sys.exit("No upload password. Run this through the paste command, which makes one.")
    found, broken = gather()
    if not found:
        sys.exit("No videos found in %s. Nothing was uploaded." % FOLDER)
    print("Found %d good videos.\n" % len(found))
    up = skip = bad = 0
    for name in sorted(found):
        m = NAME.match(name)
        prefix, num, slug = m.group(1), int(m.group(2)), m.group(3)
        base, lead = next((b, l) for p, b, l in SHOWS if p == prefix)
        n = base + num
        title = slug.replace("-", " ").title()
        slot = call({"action": "slot", "n": n, "title": name[:-4], "caption": lead + title + "." + TAIL, "cover_ms": COVER_MS.get(prefix, 0)})
        if not slot.get("ok"):
            print("%s  ... STOPPED: %s" % (name, slot.get("error", "no answer")))
            if "password" in str(slot.get("error", "")):
                sys.exit("\nThe upload password didn't match. Nothing was uploaded.")
            bad += 1
            continue
        if slot.get("skip"):
            skip += 1
            continue
        data, ok, err = found[name], False, ""
        for attempt in (1, 2, 3):
            try:
                tus_upload(data, slot, name[:-4]); ok = True; break
            except Exception as e:
                err = str(e); time.sleep(3 * attempt)
        if not ok:
            print("%s  ... upload failed: %s" % (name, err)); bad += 1; continue
        done = call({"action": "uploaded", "n": n})
        if done.get("ok"):
            up += 1; print("%s  ... uploaded (%.1f MB)" % (name, len(data) / 1e6))
        else:
            bad += 1; print("%s  ... uploaded, but the list didn't update: %s" % (name, done.get("error")))
    print("\nDONE. %d uploaded now, %d were already up, %d had a problem." % (up, skip, bad))
    if broken:
        print("\nThese files are broken and were skipped. Remake them and drop the .mp4 in the folder:")
        for b in broken:
            print("   " + b)
    print("\nOn the list:", json.dumps(call({"action": "status"}).get("counts", {})))


if __name__ == "__main__":
    main()
