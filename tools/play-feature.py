# -*- coding: utf-8 -*-
"""
Google Play feature graphic — 1024x500, exactly, no alpha.

WHY NOT RAW GAMEPLAY
  The old one was a plain screenshot: no name, no tagline. Play renders this at
  the top of the listing and as the video thumbnail, and at browse size a purple
  corridor with a score in it tells a person nothing. Same mistake the three
  original screenshots made.

CROP SAFETY
  Play crops this graphic on some surfaces, so everything that must survive sits
  inside the middle ~70%. Nothing important goes near an edge.
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1024, 500
SRC = 'assets/store/play-feature-1024x500.png'      # a real captured frame
OUT = 'assets/store/play-feature-1024x500.png'

F = 'C:/Windows/Fonts/bahnschrift.ttf'
if not os.path.exists(F):
    F = 'C:/Windows/Fonts/segoeuib.ttf'

im = Image.open(SRC).convert('RGB').resize((W, H), Image.LANCZOS)

# Darken everything, then darken the middle band further so white type holds.
im = Image.blend(im, Image.new('RGB', (W, H), (4, 4, 12)), 0.42)

# The captured frame carries the score HUD, and the crop slices it in half at the
# top edge -- half a number looks like a mistake rather than a game. Fade the top
# and bottom strips out instead of re-capturing.
edge = Image.new('L', (W, H), 0)
ed = ImageDraw.Draw(edge)
ed.rectangle([0, 0, W, 64], fill=225)
ed.rectangle([0, H - 40, W, H], fill=190)
edge = edge.filter(ImageFilter.GaussianBlur(38))
im = Image.composite(Image.new('RGB', (W, H), (3, 4, 10)), im, edge)
band = Image.new('L', (W, H), 0)
ImageDraw.Draw(band).rectangle([0, 150, W, 380], fill=190)
band = band.filter(ImageFilter.GaussianBlur(70))
im = Image.composite(Image.new('RGB', (W, H), (3, 4, 10)), im, band)

d = ImageDraw.Draw(im)

def centred(y, text, size, fill, track=0):
    f = ImageFont.truetype(F, size)
    if track:
        text = (' ' * track).join(list(text))
    w = d.textlength(text, font=f)
    d.text(((W - w) / 2 + 3, y + 3), text, font=f, fill=(0, 0, 0))
    d.text(((W - w) / 2, y), text, font=f, fill=fill)
    return w

centred(178, 'LUMEN', 132, (255, 255, 255))
d.line([(W / 2 - 150, 330), (W / 2 + 150, 330)], fill=(31, 124, 255), width=3)
centred(348, 'flip  ·  thread  ·  flow', 40, (150, 214, 255))

im.save(OUT)
print('%s  %dx%d  %.0f kB' % (OUT, im.size[0], im.size[1], os.path.getsize(OUT) / 1024))
