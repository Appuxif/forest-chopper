"""Server mirror of src/ponds.js and pond selection in grass-glades.js.

All pond geometry and levels are deterministic functions of seed and X/Z.
No changes to existing tree IDs, world seed or save-file coordinates.
"""
from functools import lru_cache
import math

from terrain_height import base_height
from lakes import lakes_near_tile,lake_normalized,lake_height_at

CELL=42
MASK=0xffffffff


def _hash(seed,gx,gz,channel):
    n=((seed&MASK)^((gx*0x1b873593)&MASK)^((gz*0x85ebca6b)&MASK)
       ^(((channel+1)*0xc2b2ae35)&MASK))
    n=((n^(n>>16))*0x7feb352d)&MASK
    n=((n^(n>>15))*0x846ca68b)&MASK
    return ((n^(n>>16))&MASK)/4294967296


def _is_pond(seed,gx,gz,x,z):
    if gx==2 and gz==1:
        return True
    if math.hypot(x,z)<75 or abs(z)<29:
        return False
    if abs(gx-2)<=1 and abs(gz-1)<=1:
        return False
    priority=_hash(seed,gx,gz,77)
    if priority>=.20:
        return False
    for dx in (-1,0,1):
        for dz in (-1,0,1):
            if dx==0 and dz==0:
                continue
            if _hash(seed,gx+dx,gz+dz,77)<priority:
                return False
    return True


def _point(p,u,angle):
    edge=1+.075*math.sin(3*angle+p['phase']) + .055*math.sin(5*angle-p['phase']*.7)
    vx=math.cos(angle)*p['rx']*u*edge
    vz=math.sin(angle)*p['rz']*u*edge
    return (p['x']+vx*p['cos']-vz*p['sin'],
            p['z']+vx*p['sin']+vz*p['cos'])


@lru_cache(maxsize=2048)
def _patch(seed,gx,gz):
    x=(gx+.5)*CELL+(_hash(seed,gx,gz,2)-.5)*15
    z=(gz+.5)*CELL+(_hash(seed,gx,gz,3)-.5)*15
    if not _is_pond(seed,gx,gz,x,z) or any(
        math.hypot(x-lake['x'],z-lake['z']) <
        max(lake['rx'],lake['rz'])*1.35+26
        for lake in lakes_near_tile(seed,x-26,z-26,52)
    ):
        return None
    radius=1.5*(6.3+4.6*_hash(seed,gx,gz,7))
    angle=_hash(seed,gx,gz,8)*math.pi*2
    p={'x':x,'z':z,'rx':radius*(.82+_hash(seed,gx,gz,9)*.36),
       'rz':radius*(.82+_hash(seed,gx,gz,10)*.36),
       'cos':math.cos(angle),'sin':math.sin(angle),
       'phase':_hash(seed,gx,gz,11)*math.pi*2,'reach':radius*1.18*1.3}
    level=min(base_height(seed,*_point(p,1.09,i*math.pi/8)) for i in range(16))
    p['level']=level-.28
    p['depth']=1.5+abs(math.sin(seed*.871+gx*19.53+gz*33.17))*1.5
    return p


def _shape(p,x,z):
    dx,dz=x-p['x'],z-p['z']
    if abs(dx)>p['reach'] or abs(dz)>p['reach']:
        return None
    rx=(dx*p['cos']+dz*p['sin'])/p['rx']
    rz=(-dx*p['sin']+dz*p['cos'])/p['rz']
    d=math.hypot(rx,rz)
    if d>1.2:
        return None
    angle=math.atan2(rz,rx)
    boundary=1+.075*math.sin(3*angle+p['phase'])+.055*math.sin(5*angle-p['phase']*.7)
    return d/boundary


def _nearby(seed,x,z):
    gx,gz=math.floor(x/CELL),math.floor(z/CELL)
    for ix in range(gx-1,gx+2):
        for iz in range(gz-1,gz+2):
            patch=_patch(seed,ix,iz)
            if patch is not None:
                yield patch


def pond_height_before_lakes(seed,x,z,base=None):
    if base is None:
        base=base_height(seed,x,z)
    height=base
    for patch in _nearby(seed,x,z):
        u=_shape(patch,x,z)
        if u is None or u>=.99:
            continue
        t=max(0,min(1,(u-.27)/(.99-.27)))
        t=t*t*(3-2*t)
        amount=1-t
        slope=max(0,min(1,u/.35))
        basin=patch['level']-patch['depth']*(1-.10*slope*slope)
        height=min(height,base+(basin-base)*amount)
    return height


def pond_height_at(seed,x,z,base=None):
    return lake_height_at(seed,x,z,pond_height_before_lakes(seed,x,z,base))


def pond_depth_at(seed,x,z):
    height=pond_height_at(seed,x,z)
    depth=0.
    for patch in _nearby(seed,x,z):
        u=_shape(patch,x,z)
        if u is None or u>=.995:
            continue
        depth=max(depth,patch['level']-height)
    for lake in lakes_near_tile(seed,x,z,0):
        u=lake_normalized(lake,x,z)
        if u is not None and u<.995:
            depth=max(depth,lake['level']-height)
    return max(0.,depth)
