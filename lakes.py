"""Server mirror of src/lakes.js: rare seeded lakes and terrain depressions."""
from functools import lru_cache
import math

from terrain_height import base_height

LAKE_CELL=512
LAKE_MAX_REACH=260
MASK=0xffffffff


def _hash(seed,gx,gz,channel):
    n=((seed&MASK)^((gx*0x1b873593)&MASK)^((gz*0x85ebca6b)&MASK)
       ^(((channel+1)*0xc2b2ae35)&MASK))
    n=((n^(n>>16))*0x7feb352d)&MASK
    n=((n^(n>>15))*0x846ca68b)&MASK
    return ((n^(n>>16))&MASK)/4294967296


def _has_lake(seed,gx,gz):
    if gx==0 and gz==-1:
        return True
    if math.hypot((gx+.5)*LAKE_CELL,(gz+.5)*LAKE_CELL)<540:
        return False
    priority=_hash(seed,gx,gz,83)
    if priority>.035:
        return False
    for dx in (-1,0,1):
        for dz in (-1,0,1):
            if dx==0 and dz==0:
                continue
            if _hash(seed,gx+dx,gz+dz,83)<priority:
                return False
    return True


def lake_point(lake,u,angle):
    boundary=1+.085*math.sin(3*angle+lake['phase']) + .06*math.sin(7*angle-lake['phase']*.65) + .035*math.sin(11*angle+lake['phase']*.4)
    dx=math.cos(angle)*lake['rx']*u*boundary
    dz=math.sin(angle)*lake['rz']*u*boundary
    return (lake['x']+dx*lake['cos']-dz*lake['sin'],
            lake['z']+dx*lake['sin']+dz*lake['cos'])


@lru_cache(maxsize=2048)
def lake_at(seed,gx,gz):
    if not _has_lake(seed,gx,gz):
        return None
    radius=100+_hash(seed,gx,gz,21)*40
    angle=_hash(seed,gx,gz,22)*math.tau
    lake={
        'kind':'lake','id':f'lake:{gx},{gz}','gx':gx,'gz':gz,
        'x':(gx+.5)*LAKE_CELL+(_hash(seed,gx,gz,24)-.5)*115,
        'z':(gz+.5)*LAKE_CELL+(_hash(seed,gx,gz,25)-.5)*115,
        'rx':radius*(.89+_hash(seed,gx,gz,26)*.20),
        'rz':radius*(.72+_hash(seed,gx,gz,27)*.26),
        'cos':math.cos(angle),'sin':math.sin(angle),
        'phase':_hash(seed,gx,gz,28)*math.tau,
        'depth':4.5+_hash(seed,gx,gz,29)*1.5,
        'reach':LAKE_MAX_REACH,
    }
    lake['level']=min(base_height(seed,*lake_point(lake,1.09,i*math.pi/20)) for i in range(40))-.35
    return lake


def lakes_near_tile(seed,x0,z0,size):
    for gx in range(math.floor((x0-LAKE_MAX_REACH)/LAKE_CELL),
                    math.floor((x0+size+LAKE_MAX_REACH)/LAKE_CELL)+1):
        for gz in range(math.floor((z0-LAKE_MAX_REACH)/LAKE_CELL),
                        math.floor((z0+size+LAKE_MAX_REACH)/LAKE_CELL)+1):
            lake=lake_at(seed,gx,gz)
            if (lake is None or lake['x']+lake['reach']<x0 or
                    lake['x']-lake['reach']>x0+size or
                    lake['z']+lake['reach']<z0 or
                    lake['z']-lake['reach']>z0+size):
                continue
            yield lake


def lake_normalized(lake,x,z):
    dx,dz=x-lake['x'],z-lake['z']
    if abs(dx)>lake['reach'] or abs(dz)>lake['reach']:
        return None
    rx=(dx*lake['cos']+dz*lake['sin'])/lake['rx']
    rz=(-dx*lake['sin']+dz*lake['cos'])/lake['rz']
    d=math.hypot(rx,rz)
    if d>1.28:
        return None
    angle=math.atan2(rz,rx)
    boundary=1+.085*math.sin(3*angle+lake['phase']) + .06*math.sin(7*angle-lake['phase']*.65) + .035*math.sin(11*angle+lake['phase']*.4)
    return d/boundary


def lake_height_at(seed,x,z,base):
    height=base
    for lake in lakes_near_tile(seed,x,z,0):
        u=lake_normalized(lake,x,z)
        if u is None or u>=.995:
            continue
        t=max(0.,min(1.,(u-.30)/(.995-.30)))
        blend=1-t*t*(3-2*t)
        slope=max(0.,min(1.,u/.38))
        basin=lake['level']-lake['depth']*(1-.08*slope*slope)
        height=min(height,base+(basin-base)*blend)
    return height
