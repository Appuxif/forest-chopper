#!/usr/bin/env python3
"""Create recolorable feather atlas PNGs used by both chicken LOD meshes."""
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path
import random, math, json
HEN=Path(__file__).resolve().parents[1]
OUT=HEN.parents[1]/"assets/models/hen/textures"  # publishable runtime textures
OUT.mkdir(parents=True,exist_ok=True)
S=1024
T=805
variants={
  "russet": {"base":(142,76,44),"tail":(42,47,43),"shaft":(197,132,82)},
  "white": {"base":(227,222,205),"tail":(219,216,209),"shaft":(242,237,219)},
  "black": {"base":(37,39,40),"tail":(25,31,36),"shaft":(78,82,83)},
  "golden": {"base":(207,146,62),"tail":(109,73,33),"shaft":(237,191,114)},
  "speckled": {"base":(137,129,114),"tail":(53,54,56),"shaft":(213,198,165)},
}
def mult(c,f):
 return tuple(max(0,min(255,int(x*f))) for x in c)
def blend(a,b,w):
 return tuple(max(0,min(255,int(a[i]*(1-w)+b[i]*w))) for i in range(3))
for vi,(name,profile) in enumerate(variants.items()):
 rng=random.Random(8701)
 base,tail,shaft=profile["base"],profile["tail"],profile["shaft"]
 img=Image.new("RGB",(S,S),mult(base,.79))
 d=ImageDraw.Draw(img,"RGB")
 # Micro-noise underneath vane pattern prevents uniform-looking plastic.
 for yy in range(0,S,4):
  for xx in range(0,T,4):
   shade=rng.uniform(.90,1.1)
   d.rectangle((xx,yy,xx+3,yy+3),fill=mult(base,shade))
 # tightly layered feather vanes, alternating rows, varied lengths and pigmentation.
 row_h=34; feather_len=66; col_w=29.5
 for row in range(-2,math.ceil(S/row_h)+2):
  y=row*row_h-23
  for col in range(-2,math.ceil(T/col_w)+3):
   cx=col*col_w +(row%2)*col_w*.51 + rng.uniform(-3,3)
   fy=y+rng.uniform(-5,5)
   w=col_w*rng.uniform(.83,1.10)
   h=feather_len*rng.uniform(.82,1.16)
   factor=rng.uniform(.79,1.22)
   if name=="speckled":
    factor=rng.choice([.40,.60,1.04,1.35,1.48])+rng.uniform(-.09,.09)
   if name=="black": factor=rng.uniform(.67,1.50)
   if name=="white": factor=rng.uniform(.92,1.06)
   if name=="golden": factor=rng.uniform(.82,1.14)
   color=mult(base,factor)
   polygon=[]
   for i in range(15):
    t=i/14
    width=math.sin(math.pi*(.04+.93*t))**.70*w*.51*(1-.08*t)
    skew=.13*w*(t*t) +2*math.sin(row*2+col*4)*t
    polygon.append((cx-width+skew,fy+t*h))
   for i in range(14,-1,-1):
    t=i/14
    width=math.sin(math.pi*(.04+.93*t))**.70*w*.51*(1-.08*t)
    skew=.13*w*(t*t)+2*math.sin(row*2+col*4)*t
    polygon.append((cx+width+skew,fy+t*h))
   # dark border gives overlapping depth but isn't outlined like a cartoon.
   d.polygon([(x+1.2,y+2.0) for x,y in polygon],fill=mult(color,.63))
   d.polygon(polygon,fill=color)
   # feather shaft with fine oblique barbs.
   shaft_color=blend(color,shaft,.35 if name not in ("white","black") else .18)
   d.line([(cx,fy+8),(cx+2,fy+h*.88)],fill=shaft_color,width=1)
   for step in range(4,19):
    t=step/22
    ypos=fy+t*h
    half=math.sin(math.pi*(.04+.93*t))**.7*w*.48
    if half<3: continue
    v_color=blend(color,(0,0,0),.18)
    if name=="black":v_color=mult(color,1.22)
    for sign in (-1,1):
     d.line([(cx+sign*1,ypos),
             (cx+sign*(half*.90),ypos+h*.065)],fill=v_color,width=1)
   # subtle bright edge.
   if rng.random()<.56:
    d.line([polygon[3],polygon[5],polygon[7]],fill=mult(color,1.11),width=1)
 # Dark tail sector with tapered feather-like shafts; V runs from base to tip.
 d.rectangle((T,0,S,S),fill=tail)
 for i in range(26):
  xx=T+(i+.5)*(S-T)/26
  shade=rng.uniform(.76,1.22)
  color=mult(tail,shade)
  d.polygon([(xx-3,0),(xx+4,0),(xx+10,S),(xx-5,S)],fill=color)
  linecol=blend(color,shaft,.30)
  d.line([(xx+2,0),(xx+5,S)],fill=linecol,width=1)
  for yy in range(0,S,20):
   d.line([(xx+2,yy),(xx-4,yy+9)],fill=mult(color,1.14),width=1)
   d.line([(xx+2,yy),(xx+8,yy+9)],fill=mult(color,.80),width=1)
 # Slight optical blur to anti-alias overly fine geometry on distant LOD.
 img=img.filter(ImageFilter.GaussianBlur(.30))
 fn=OUT/f"hen_plumage_{name}.png"
 img.save(fn,optimize=True)
 print(name,fn,fn.stat().st_size)
(HEN/"hen_colors.json").write_text(json.dumps({
 "swapMaterial":"Hen Plumage | color atlas",
 "baseColorTextures":{k:f"assets/models/hen/textures/hen_plumage_{k}.png" for k in variants},
 "lods":{"10k":"assets/models/hen_low_10k.glb","3k":"assets/models/hen_low_3k.glb"},
 "note":"Both GLBs embed russet by default. Replace the base color texture of 'Hen Plumage | color atlas' at runtime, or export a variant. Tail and wings share the same UV atlas as body."
},indent=2))
