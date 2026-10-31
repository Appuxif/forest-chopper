#!/usr/bin/env python3
"""Generate reproducible UV tile albedo PNGs for Forest Chopper outfits.

Only textures: never change geometry, rigs, or existing GLB assets.
Color variants are shared by male/female assets that use the same clothing id.
"""
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

BASE = Path(__file__).resolve().parents[1]
CATALOG = BASE / "source" / "clothing-variants.json"
TARGET = BASE / "textures" / "clothing"


def rgb(hex_value):
    return tuple(bytes.fromhex(hex_value.lstrip("#")))


def mix(a, b, fraction):
    return tuple(round(x * (1 - fraction) + y * fraction) for x, y in zip(a, b))


def image_for(item, variant, size):
    base = rgb(variant["color"])
    accent = rgb(variant.get("accent", "#d1c9aa"))
    style = variant["style"]
    rnd = random.Random(item + "|" + variant["id"] + "|" + str(variant["seed"]))

    noise = Image.frombytes("L", (size, size), rnd.randbytes(size * size))
    strength = 0.065 if style != "leather" else 0.09
    bands = [
        noise.point([max(0, min(255, int(value + (i - 127) * strength)))
                     for i in range(256)])
        for value in base
    ]
    im = Image.merge("RGB", bands)
    draw = ImageDraw.Draw(im, "RGBA")

    if style == "plaid":
        period = 88
        thread = mix(base, accent, 0.7)
        dark = mix(base, (15, 17, 18), 0.50)
        for origin in range(-period, size + period, period):
            for pos, width, color, opacity in [
                (0, 18, thread, 85), (22, 4, dark, 95),
                (29, 2, accent, 160), (50, 11, dark, 100),
                (67, 3, thread, 120), (73, 1, accent, 190),
            ]:
                x = origin + pos
                draw.rectangle((x, 0, x + width, size), fill=(*color, opacity))
                draw.rectangle((0, x, size, x + width), fill=(*color, opacity))
        # Weave at the intersections, so plaid reads as actual flannel.
        for y in range(0, size, 3):
            draw.line((0, y, size, y), fill=(*accent, 10), width=1)
        for x in range(0, size, 3):
            draw.line((x, 0, x, size), fill=(15, 16, 15, 9), width=1)

    elif style == "denim":
        highlight = mix(base, (207, 205, 201), .32)
        shadow = mix(base, (10, 20, 26), .38)
        # Twill's diagonal diagonal interlacing remains visible on seams.
        for start in range(-size, size * 2, 4):
            draw.line((start, 0, start + size, size),
                      fill=(*highlight, 44), width=1)
            draw.line((start + 2, 0, start + size + 2, size),
                      fill=(*shadow, 37), width=1)
        for y in range(0, size, 5):
            draw.line((0, y, size, y), fill=(*highlight, 12), width=1)

    elif style in ("canvas", "waxed"):
        highlight = mix(base, (223, 211, 182), .30)
        dark = mix(base, (22, 25, 22), .25)
        for x in range(0, size, 3):
            draw.line((x, 0, x, size), fill=(*highlight, 35 if style == "canvas" else 17), width=1)
        for y in range(0, size, 4):
            draw.line((0, y, size, y), fill=(*dark, 25), width=1)
        if style == "waxed":
            for _ in range(180):
                x = rnd.randrange(size); y = rnd.randrange(size)
                draw.line((x, y, x + rnd.randrange(6, 38), y + rnd.randrange(-2, 3)),
                          fill=(*highlight, rnd.randrange(4, 22)), width=1)

    elif style == "fleece":
        lighter = mix(base, (230, 226, 211), .23)
        for _ in range(15000):
            x = rnd.randrange(size); y = rnd.randrange(size)
            draw.point((x, y), fill=(*lighter, rnd.randrange(5, 30)))

    elif style == "cotton":
        lighter = mix(base, (230, 225, 211), .22)
        shadow = mix(base, (25, 25, 24), .2)
        for y in range(0, size, 3):
            draw.line((0, y, size, y), fill=(*lighter, 24), width=1)
        for x in range(0, size, 4):
            draw.line((x, 0, x, size), fill=(*shadow, 12), width=1)

    elif style in ("leather", "suede"):
        highlight = mix(base, (224, 207, 166), .35)
        shadow = mix(base, (19, 17, 13), .45)
        grain = 12000 if style == "suede" else 6000
        for _ in range(grain):
            x = rnd.randrange(size); y = rnd.randrange(size)
            c = highlight if rnd.random() > .55 else shadow
            draw.point((x, y), fill=(*c, rnd.randrange(5, 30)))
        if style == "leather":
            for _ in range(170):
                x = rnd.randrange(size); y = rnd.randrange(size)
                draw.line((x, y, x + rnd.randrange(2, 15), y + rnd.randrange(-4, 5)),
                          fill=(*highlight, rnd.randrange(10, 45)), width=1)

    # Subtle discoloration from outdoor wear, not distracting polka dots.
    stains = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(stains, "RGBA")
    for _ in range(16):
        cx = rnd.randrange(size); cy = rnd.randrange(size)
        radius = rnd.randrange(12, 65)
        bright = rnd.choice((-1, 1))
        tint = mix(base, (219, 210, 184) if bright > 0 else (22, 25, 21), .6)
        sd.ellipse((cx - radius, cy - radius // 2, cx + radius, cy + radius // 2),
                   fill=(*tint, rnd.randrange(4, 17)))
    stains = stains.filter(ImageFilter.GaussianBlur(14))
    im = Image.alpha_composite(im.convert("RGBA"), stains).convert("RGB")
    return im


def main():
    catalog = json.loads(CATALOG.read_text())
    for item, variants in catalog["items"].items():
        folder = TARGET / item
        folder.mkdir(parents=True, exist_ok=True)
        for variant in variants:
            if variant.get("original"):
                continue
            path = folder / (variant["id"] + ".png")
            image_for(item, variant, catalog["resolution"]).save(path, optimize=True)
            print(path.relative_to(BASE))


if __name__ == "__main__":
    main()
