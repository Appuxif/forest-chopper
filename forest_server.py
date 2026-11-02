#!/usr/bin/env python3
"""Forest Chopper multiplayer server. pip install websockets>=13"""
import argparse
import asyncio
import json
import math
import os
import random
import re
import time
from functools import lru_cache
from pathlib import Path
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed
from box_registry import BoxRegistry,AOI_RADIUS
from server_bots import BotManager, can_stand
from terrain_height import height_at, base_height
from ponds import pond_depth_at, pond_height_before_lakes

MAX_MESSAGE = 2048
# Initial 3 kg axe leaves room for nine 10 kg logs, regardless of bag slots.
DEFAULT_WOOD_CAPACITY = 3
BOX_TTL_SECONDS=3600
STARVATION_INTERVAL_SECONDS=10
MAX_GROUND_DROPS=10_000
TREE_LOG_COUNT=3
FALLEN_LOG_LENGTH=3.0
FALLEN_LOG_GAP=.08
# Matches the shortened 10–15s tree-fall audio accelerated by 1.3x.
FALL_DURATION=5/1.3

def fallen_log_mask(box):
    return box.get('mask',(1<<box['item']['count'])-1)

def fallen_log_segments(box):
    mask=fallen_log_mask(box)
    angle=box.get('direction',0)
    dx,dz=-math.sin(angle),math.cos(angle)
    return [(i,box['x']+dx*(i+.5)*(FALLEN_LOG_LENGTH+FALLEN_LOG_GAP),
             box['z']+dz*(i+.5)*(FALLEN_LOG_LENGTH+FALLEN_LOG_GAP))
            for i in range(5) if mask&(1<<i)]

def valid_fallen_log_layout(box):
    if not is_fallen_logs(box):return False
    angle=box.get('direction',0)
    mask=fallen_log_mask(box)
    return (box['item']['id']=='log' and box['expires_at']>=0
            and type(angle) in (int,float) and math.isfinite(angle) and abs(angle)<=100
            and type(mask) is int and 1<=mask<=31
            and mask.bit_count()==box['item']['count']
            and (box.get('tree') is None or isinstance(box['tree'],str))
            and (box.get('ready_at') is None or
                 (type(box['ready_at']) in (int,float) and math.isfinite(box['ready_at']))))

def is_fallen_logs(box):
    return isinstance(box,dict) and box.get('kind')=='fallen_logs'

def fallen_logs_box(x,z,count=TREE_LOG_COUNT,direction=0,tree=None,ready_at=None):
    box={'x':x,'z':z,'kind':'fallen_logs','direction':direction,
         'mask':(1<<count)-1,'expires_at':time.time()+BOX_TTL_SECONDS,
         'item':{'id':'log','count':count}}
    if tree is not None:box['tree']=tree
    if ready_at is not None:box['ready_at']=ready_at
    return box

MUSHROOM_SPECIES=('fly_agaric','boletus','death_cap','milkcap')
FLOWER_SPECIES=('daisy','buttercup','pink_wildflower','blue_wildflower')
DECOR_ITEM_IDS=tuple('mushroom:'+name for name in MUSHROOM_SPECIES)+tuple('flower:'+name for name in FLOWER_SPECIES)+('dry_grass',)
STRUCTURE_KINDS=("campfire","torch","table","fence","workbench","alchemy_table","bed","chest","rack")
STRUCTURE_WEIGHTS={"campfire":18,"torch":4,"table":18,"fence":12,"workbench":25,"alchemy_table":35,"bed":18,"chest":15,"rack":16}
ITEM_LIMITS={**{name:1 for name in STRUCTURE_KINDS},"log":5,"branch":10,"stone":10,"bench":1,"axe":1,"potion:health":10,"potion:stamina":10,"potion:lumberjack":10,"potion:light_feet":10,"potion:night_vision":10,"food:mushroom_stew":10,"food:herbal_mushroom_stew":10,
             **{name:10 for name in DECOR_ITEM_IDS}}
MAX_CARRY_WEIGHT=100
ITEM_WEIGHT={**STRUCTURE_WEIGHTS,"log":10,"branch":0.5,"stone":2,"bench":15,"axe":3,"potion:health":0.5,"potion:stamina":0.5,"potion:lumberjack":0.5,"potion:light_feet":0.5,"potion:night_vision":0.5,"food:mushroom_stew":0.6,"food:herbal_mushroom_stew":0.7,
             **{name:0.1 for name in DECOR_ITEM_IDS}}

def item_weight(item):
    return ITEM_WEIGHT[item['id']] * (1 if item['id']=='axe' else item['count']) if item else 0

def inv_weight(inv):
    return sum(item_weight(item) for item in inv if item)

def inv_weight_space(inv,kind):
    return max(0,math.floor((MAX_CARRY_WEIGHT-inv_weight(inv)+1e-8)/ITEM_WEIGHT[kind]))

DECOR_CHUNK_SIZE=24
DECOR_SLOTS=25
AXE_LEVELS = ((1, 1.0), (2, 1.2), (3, 1.45), (4, 1.7))

def r(x,z,n,seed):
    v=math.sin(x*127.1+z*311.7+n*78.233+seed)*43758.5453
    return v-math.floor(v)

TREE_MIN_DISTANCE = 4.0


@lru_cache(maxsize=32768)
def tree_can_spawn(cx, cz, index, seed):
    # The matching client algorithm never depends on stream/load order.
    x=cx*24+r(cx,cz,index*3,seed)*24
    z=cz*24+r(cx,cz,index*3+1,seed)*24
    if math.hypot(x,z)<8:
        return False
    priority=r(cx,cz,2000+index,seed)
    for nx in range(cx-1,cx+2):
        for nz in range(cz-1,cz+2):
            for j in range(8):
                if (nx,nz,j)==(cx,cz,index):
                    continue
                xx=nx*24+r(nx,nz,j*3,seed)*24
                zz=nz*24+r(nx,nz,j*3+1,seed)*24
                if math.hypot(xx,zz)<8 or (xx-x)**2+(zz-z)**2>=TREE_MIN_DISTANCE**2:
                    continue
                theirs=r(nx,nz,2000+j,seed)
                if theirs<priority or (theirs==priority and (nx,nz,j)<(cx,cz,index)):
                    return False
    return True


def tree_info(key,seed):
    try:
        chunk,index=key.split(':');cx,cz=map(int,chunk.split(','));i=int(index)
        if not (-10000<=cx<=10000 and -10000<=cz<=10000 and 0<=i<8):return None
        x=cx*24+r(cx,cz,i*3,seed)*24
        z=cz*24+r(cx,cz,i*3+1,seed)*24
        if not tree_can_spawn(cx,cz,i,seed) or pond_depth_at(seed,x,z)>.12:return None
        hp=7+int(r(x,z,8,seed)*5)
        return x,z,hp
    except (ValueError,TypeError):return None

MAX_VITALS=5
LOW_VITALS_THRESHOLD=1
HUNGER_INTERVAL_SECONDS=192
STAMINA_SPRINT_DRAIN=0.8
STAMINA_REGEN=0.65
STAMINA_HIT_COST=1.0
STAMINA_JUMP_COST=1.0
STAMINA_MIN_ACTION=1.0
STAMINA_SPRINT_RECOVER=0.5
FOOD_EFFECTS={
    'mushroom:fly_agaric':(-1,0),
    'mushroom:death_cap':(-1,0),
    'mushroom:milkcap':(0,1),
    'mushroom:boletus':(0,1),
    'flower:daisy':(1,0),
    'flower:buttercup':(0,0),
    'flower:pink_wildflower':(0,0),
    'flower:blue_wildflower':(0,0),
    'potion:health':(3,1),
    'potion:stamina':(0,0),
    'potion:lumberjack':(-1,0),
    'potion:light_feet':(0,-1),
    'potion:night_vision':(-1,0),
    'food:mushroom_stew':(0,3),
    'food:herbal_mushroom_stew':(1,3),
}
FOOD_RECIPES={
    'food:mushroom_stew':{'mushroom:boletus':1,'mushroom:milkcap':1},
    'food:herbal_mushroom_stew':{'mushroom:boletus':1,'mushroom:milkcap':1,'flower:blue_wildflower':1},
}
POTION_RECIPES={
    'potion:health':{'flower:daisy':2,'mushroom:boletus':1},
    'potion:stamina':{'flower:blue_wildflower':2,'flower:pink_wildflower':2},
    'potion:lumberjack':{'mushroom:fly_agaric':1,'flower:pink_wildflower':2,'flower:daisy':1},
    'potion:light_feet':{'flower:blue_wildflower':2,'flower:pink_wildflower':1,'flower:buttercup':1},
    'potion:night_vision':{'mushroom:fly_agaric':1,'flower:blue_wildflower':1,'flower:buttercup':1},
}
STATUS_DURATION=30
STATUS_REGEN_MULTIPLIER=2
STATUS_EFFECT_DURATIONS={
    'stamina_regen':30,'lumberjack':45,'light_feet':45,'night_vision':300,
}
POTION_STATUS={
    'potion:stamina':'stamina_regen',
    'potion:lumberjack':'lumberjack',
    'potion:light_feet':'light_feet',
    'potion:night_vision':'night_vision',
}
STATUS_PLAYER_KEYS={
    'stamina_regen':'stamina_boost_until',
    'lumberjack':'lumberjack_until',
    'light_feet':'light_feet_until',
    'night_vision':'night_vision_until',
}
def status_active(player,status,now=None):
    return player.get(STATUS_PLAYER_KEYS[status],0)>(time.time() if now is None else now)
def active_status_ids(player,now=None):
    now=time.time() if now is None else now
    return frozenset(status for status,key in STATUS_PLAYER_KEYS.items()
                     if player.get(key,0)>now)
def chop_damage_multiplier(player,now=None):
    return 2 if status_active(player,'lumberjack',now) else 1
def sprint_drain_multiplier(player,now=None):
    return .5 if status_active(player,'light_feet',now) else 1


CRAFT_STATION_RADIUS=10
def has_crafting_station(camp,kind,x,z):
    return any(item['kind']==kind and math.hypot(item['x']-x,item['z']-z)<=CRAFT_STATION_RADIUS
               for item in camp.values())


def fall_damage_for_height(height):
    """Same three discrete thresholds as the browser controller."""
    if not math.isfinite(height) or height < 3 - 1e-6:
        return 0
    if height >= 5 - 1e-6:
        return 5
    return 3 if height >= 4 - 1e-6 else 2


def record_fall_landing(player, old_y, y, airborne):
    """Return (drop, damage) once, on validated transition to landing.

    Called only *after* a network movement packet passes anti-cheat checks.
    The client provides positions, never a damage number or fall height.
    """
    peak = player.get('fall_peak')
    if airborne:
        player['fall_peak'] = max(old_y, y, peak if peak is not None else old_y)
        return None
    player['fall_peak'] = None
    if peak is None:
        return None
    drop = max(0.0, peak - y)
    damage = fall_damage_for_height(drop)
    return (drop, damage) if damage else None


def vitals_view(player):
    view={'health':player['health'],'hunger':player['hunger'],
          'stamina':round(player.get('stamina',MAX_VITALS),3),
          'staminaLocked':player.get('stamina_sprint_locked',False),
          'hungerProgress':player['hunger_progress']}
    now=time.time()
    effects=[{'id':status,'expires_at':player[key]}
             for status,key in STATUS_PLAYER_KEYS.items()
             if player.get(key,0)>now]
    if effects:view['effects']=effects
    return view

def advance_hunger(player,now):
    delta=max(0,min(now-player['last_hunger_at'],3600))
    player['last_hunger_at']=now
    if player['hunger']==0:
        progress=player.get('starvation_progress',0)+delta
        damage=int(progress//STARVATION_INTERVAL_SECONDS)
        player['starvation_progress']=progress%STARVATION_INTERVAL_SECONDS
        if damage:
            player['health']=max(0,player['health']-damage)
            return True
        return False
    progress=player['hunger_progress']+delta
    steps=int(progress//HUNGER_INTERVAL_SECONDS)
    if steps==0:
        player['hunger_progress']=progress
        return False
    player['hunger']=max(0,player['hunger']-steps)
    player['hunger_progress']=progress%HUNGER_INTERVAL_SECONDS if player['hunger'] else 0
    if not player['hunger']:player['starvation_progress']=0
    return True

def advance_stamina(player,now):
    last=player.get('last_stamina_at',now)
    elapsed=max(0,min(now-last,1))
    player['last_stamina_at']=now
    before=player.get('stamina',float(MAX_VITALS))
    if player.get('sprinting',False) and not player.get('stamina_sprint_locked',False):
        value=max(0,before-STAMINA_SPRINT_DRAIN*sprint_drain_multiplier(player)*elapsed)
        if value<=0:
            player['stamina_sprint_locked']=True
            player['sprinting']=False
    else:
        value=min(MAX_VITALS,before+STAMINA_REGEN*(STATUS_REGEN_MULTIPLIER if player.get('stamina_boost_until',0)>time.time() else 1)*elapsed)
        if value>=STAMINA_SPRINT_RECOVER:
            player['stamina_sprint_locked']=False
    player['stamina']=value
    return abs(before-value)>1e-8

def server_can_sprint(player):
    return (player.get('stamina',MAX_VITALS)>0
            and not player.get('stamina_sprint_locked',False))

def server_chop_warning(player):
    if player['health']<=LOW_VITALS_THRESHOLD:return 'Мало жизней'
    if player['hunger']<=LOW_VITALS_THRESHOLD:return 'Вы голодны'
    if player.get('stamina',MAX_VITALS)<=STAMINA_MIN_ACTION+1e-6:return 'Нет сил'
    return ''

def server_can_hit(player):
    return (player['health']>LOW_VITALS_THRESHOLD
            and player['hunger']>LOW_VITALS_THRESHOLD
            and player.get('stamina',MAX_VITALS)>STAMINA_MIN_ACTION+1e-6)

def spend_hit_stamina(player):
    if not server_can_hit(player):return False
    player['stamina']=max(0,player.get('stamina',MAX_VITALS)-STAMINA_HIT_COST)
    if player['stamina']<=0:
        player['stamina_sprint_locked']=True
        player['sprinting']=False
    return True

def apply_food(player,kind):
    effect=FOOD_EFFECTS.get(kind)
    if effect is None:return False
    player['health']=max(0,min(MAX_VITALS,player['health']+effect[0]))
    player['hunger']=max(0,min(MAX_VITALS,player['hunger']+effect[1]))
    if player['hunger']>0:player['starvation_progress']=0
    status=POTION_STATUS.get(kind)
    if status:
        # Every fresh dose refreshes its own timer, never stacks multipliers.
        # Damage to health / hunger is immediate, including when already low.
        player[STATUS_PLAYER_KEYS[status]]=time.time()+STATUS_EFFECT_DURATIONS[status]
    return True

def new_inventory():
    return [{'id':'axe','tier':0}]+[None]*11

def inv_logs(inv):
    return sum(item['count'] for item in inv if item and item['id']=='log')

def inv_space_for(inv,kind,count=1):
    if kind=='bench':
        return count==1 and inv_can_add(inv,{'id':'bench','count':1})
    if kind=='log':
        return inv_weight_space(inv,'log')>=count and sum(
            (5-item['count'] if item and item['id']=='log' else 5 if item is None else 0)
            for item in inv)>=count
    return False

def inv_give_logs(inv,amount):
    if type(amount) is not int or amount<0:return 0
    allowed=min(amount,inv_weight_space(inv,'log'))
    left=allowed
    for item in inv:
        if item and item['id']=='log' and left:
            n=min(left,5-item['count']);item['count']+=n;left-=n
    for i,item in enumerate(inv):
        if item is None and left:
            n=min(left,5);inv[i]={'id':'log','count':n};left-=n
    return allowed-left

def inv_take_logs(inv,amount):
    if inv_logs(inv)<amount:return False
    for i in reversed(range(len(inv))):
        item=inv[i]
        if item and item['id']=='log' and amount:
            n=min(amount,item['count']);item['count']-=n;amount-=n
            if item['count']==0:inv[i]=None
    return True

def inv_add_bench(inv):
    if inv_weight_space(inv,'bench')<1:return False
    try:i=inv.index(None)
    except ValueError:return False
    inv[i]={'id':'bench','count':1}
    return True

def valid_item(item):
    if not isinstance(item,dict) or item.get('id') not in ITEM_LIMITS:return False
    if item['id']=='axe':return type(item.get('tier')) is int and 0<=item['tier']<len(AXE_LEVELS)
    return type(item.get('count')) is int and 1<=item['count']<=ITEM_LIMITS[item['id']]

def inv_count(inv,kind):
    return sum((1 if kind=='axe' else item['count']) for item in inv if item and item['id']==kind)

def inv_capacity_reason(inv,item):
    if valid_item(item) and inv_weight(inv)+item_weight(item)>MAX_CARRY_WEIGHT+1e-8:
        return 'Превышен лимит переносимого веса (100 кг)'
    return 'Сумка заполнена'

def inv_can_add(inv,item):
    if not valid_item(item) or inv_weight(inv)+item_weight(item)>MAX_CARRY_WEIGHT+1e-8:return False
    if item['id'] in ('axe','bench',*STRUCTURE_KINDS):return None in inv
    limit=ITEM_LIMITS[item['id']]
    return sum(limit-it['count'] if it and it['id']==item['id'] else limit if it is None else 0 for it in inv)>=item['count']

def inv_add(inv,item):
    if not inv_can_add(inv,item):return False
    kind=item['id'];left=1 if kind=='axe' else item['count']
    if kind not in ('axe','bench',*STRUCTURE_KINDS):
        for it in inv:
            if it and it['id']==kind and left:
                n=min(left,ITEM_LIMITS[kind]-it['count']);it['count']+=n;left-=n
    for i,it in enumerate(inv):
        if it is None and left:
            if kind=='axe':inv[i]={'id':'axe','tier':item['tier']};left=0
            else:
                n=min(left,ITEM_LIMITS[kind])
                inv[i]={'id':kind,'count':n};left-=n
    return left==0

def inv_take(inv,kind,amount):
    if inv_count(inv,kind)<amount:return False
    for i in reversed(range(len(inv))):
        it=inv[i]
        if it and it['id']==kind and amount:
            n=min(amount,1 if kind=='axe' else it['count'])
            if kind=='axe':inv[i]=None
            else:
                it['count']-=n
                if not it['count']:inv[i]=None
            amount-=n
    return True

# Bounded, persistent campsite structures; no autonomous respawn or fuel.
CAMP_RECIPES={
    'campfire':{'log':2,'stone':3},
    'torch':{'branch':1,'stone':3,'dry_grass':1},
    'table':{'log':3},
    'fence':{'log':2,'branch':2},
    'workbench':{'log':4,'stone':2},
    'alchemy_table':{'log':3,'stone':5,'branch':5,'flower:daisy':3,'flower:pink_wildflower':2,'flower:blue_wildflower':3,'mushroom:fly_agaric':1},
    'bed':{'log':3,'branch':4,'dry_grass':5},
}
MAX_CAMP_STRUCTURES=100
def valid_camp_structure(item):
    return (isinstance(item,dict) and item.get('kind') in CAMP_RECIPES
            and type(item.get('id')) is int and 0<item['id']<2147483647
            and type(item.get('orientation')) is int and item['orientation'] in range(4)
            and type(item.get('lit')) is bool
            and (item['kind'] in ('campfire','torch') or not item['lit'])
            and all(type(item.get(axis)) in (int,float) and
                    math.isfinite(item[axis]) and abs(item[axis])<=240000
                    for axis in ('x','z')))
# Server-authoritative chest and log-rack inventory transactions.
CHEST_SLOTS=24
CHEST_MAX_WEIGHT=300
RACK_MAX_LOGS=48
STORAGE_COST={'chest':{'log':2,'branch':4},'rack':{'log':2}}
STRUCTURE_RECIPES={**CAMP_RECIPES,**STORAGE_COST}

def valid_storage(storage):
    if not isinstance(storage,dict) or type(storage.get('id')) is not int or not 0<storage['id']<2147483647:
        return False
    if any(type(storage.get(k)) not in (int,float) or not math.isfinite(storage[k]) or abs(storage[k])>240000 for k in ('x','z')):
        return False
    if storage.get('kind')=='rack':
        return type(storage.get('logs')) is int and 0<=storage['logs']<=RACK_MAX_LOGS
    if storage.get('kind')!='chest' or not isinstance(storage.get('name'),str) or len(storage['name'])>40:
        return False
    slots=storage.get('slots')
    return (isinstance(slots,list) and len(slots)==CHEST_SLOTS
            and all(item is None or valid_item(item) for item in slots)
            and inv_weight(slots)<=CHEST_MAX_WEIGHT+1e-8)

def new_storage(kind,ident,x,z):
    if kind=='chest':
        return {'kind':kind,'id':ident,'x':x,'z':z,'name':'Сундук','slots':[None]*CHEST_SLOTS}
    return {'kind':kind,'id':ident,'x':x,'z':z,'logs':0}

def storage_transfer(player,storage,direction,slot,qty):
    if type(qty) is not int or qty<1 or qty>50000 or type(slot) is not int:return False
    player_inv=player['inventory']
    if storage['kind']=='rack':
        if direction=='deposit':
            if storage['logs']+qty>RACK_MAX_LOGS or inv_count(player_inv,'log')<qty:return False
            inv_take(player_inv,'log',qty);storage['logs']+=qty;player['wood']-=qty;return True
        if direction=='withdraw':
            if storage['logs']<qty or not inv_space_for(player_inv,'log',qty):return False
            if inv_give_logs(player_inv,qty)!=qty:return False
            storage['logs']-=qty;player['wood']+=qty;return True
        return False
    if storage['kind']!='chest':return False
    if direction=='deposit':
        if not 0<=slot<len(player_inv):return False
        source=player_inv[slot]
        if not source or qty>(1 if source['id']=='axe' else source['count']):return False
        moving=source.copy() if source['id']=='axe' else {'id':source['id'],'count':qty}
        destination=storage['slots']
        if inv_weight(destination)+item_weight(moving)>CHEST_MAX_WEIGHT+1e-8 or not inv_can_add_storage(destination,moving):return False
        # Both sides validated. Destination can hold the whole quantity.
        if not inv_add_storage(destination,moving):return False
        if qty==(1 if source['id']=='axe' else source['count']):player_inv[slot]=None
        else:source['count']-=qty
        if source['id']=='log':player['wood']-=qty
        return True
    if direction=='withdraw':
        destination=player_inv
        if not 0<=slot<CHEST_SLOTS:return False
        source=storage['slots'][slot]
        if not source or qty>(1 if source['id']=='axe' else source['count']):return False
        moving=source.copy() if source['id']=='axe' else {'id':source['id'],'count':qty}
        if not inv_add(destination,moving):return False
        if qty==(1 if source['id']=='axe' else source['count']):storage['slots'][slot]=None
        else:source['count']-=qty
        if source['id']=='log':player['wood']+=qty
        return True
    return False

def storage_move_slot(player,storage,from_area,from_slot,to_area,to_slot,half=False):
    # Slot-exact, atomic drag/drop. Same validation as the JS offline model.
    if (storage['kind']!='chest' or from_area not in ('chest','bag')
        or to_area not in ('chest','bag') or type(from_slot) is not int
        or type(to_slot) is not int or type(half) is not bool):
        return False
    bag=[it.copy() if it else None for it in player['inventory']]
    chest=[it.copy() if it else None for it in storage['slots']]
    source=chest if from_area=='chest' else bag
    target=chest if to_area=='chest' else bag
    if (not 0<=from_slot<len(source) or not 0<=to_slot<len(target)
        or (from_area==to_area and from_slot==to_slot) or source[from_slot] is None):
        return False
    item=source[from_slot]
    destination=target[to_slot]
    count=1 if item['id']=='axe' else item['count']
    partial=half and count>1
    qty=count//2 if partial else count
    if partial and destination and destination['id']!=item['id']:return False
    if (destination and destination['id']==item['id'] and
        item['id'] not in ('axe','bench',*STRUCTURE_KINDS)):
        n=min(qty,ITEM_LIMITS[item['id']]-destination['count'])
        if n<=0:return False
        destination['count']+=n;item['count']-=n
        if item['count']==0:source[from_slot]=None
    elif destination is None:
        if partial:
            item['count']-=qty
            target[to_slot]={'id':item['id'],'count':qty}
        else:
            target[to_slot]=item
            source[from_slot]=None
    elif not partial:
        target[to_slot]=item
        source[from_slot]=destination
    else:return False
    if (any(x is not None and not valid_item(x) for x in bag+chest)
        or inv_weight(bag)>MAX_CARRY_WEIGHT+1e-8
        or inv_weight(chest)>CHEST_MAX_WEIGHT+1e-8):return False
    player['inventory'][:]=bag
    storage['slots'][:]=chest
    player['wood']=inv_count(bag,'log')
    return True

def inv_can_add_storage(slots,item):
    if not valid_item(item):return False
    if item['id'] in ('axe','bench'):return None in slots
    limit=ITEM_LIMITS[item['id']]
    return sum(limit-s['count'] if s and s['id']==item['id'] else limit if s is None else 0 for s in slots)>=item['count']

def inv_add_storage(slots,item):
    if not inv_can_add_storage(slots,item):return False
    kind=item['id'];left=1 if kind=='axe' else item['count']
    if kind not in ('axe','bench',*STRUCTURE_KINDS):
        for slot in slots:
            if slot and slot['id']==kind and left:
                n=min(left,ITEM_LIMITS[kind]-slot['count']);slot['count']+=n;left-=n
    for i,slot in enumerate(slots):
        if slot is None and left:
            if kind=='axe':slots[i]=item.copy();left=0
            else:
                n=min(left,ITEM_LIMITS[kind]);slots[i]={'id':kind,'count':n};left-=n
    return left==0

# Seeded resource positions are shared by every player. Only respawn deadlines
# for COLLECTED IDs live in the world save.
RESOURCE_ZONE_SIZE=10
RESOURCE_PER_ZONE=2
RESOURCE_LIMIT=9*RESOURCE_PER_ZONE
RESOURCE_RESPAWN_SECONDS=600

def resource_hash(seed,zx,zz,index,channel):
    mask=0xffffffff
    h=((seed&mask)^((zx*0x9e3779b1)&mask)^((zz*0x85ebca77)&mask)
       ^(((index+1)*0xc2b2ae3d)&mask)^(((channel+1)*0x27d4eb2f)&mask))
    h=(h^(h>>16))&mask
    h=(h*0x7feb352d)&mask
    h=(h^(h>>15))&mask
    h=(h*0x846ca68b)&mask
    h=(h^(h>>16))&mask
    return h/4294967296

def decor_rand(seed,cx,cz,channel):
    v=math.sin(cx*127.1+cz*311.7+channel*78.233+seed)*43758.5453
    return v-math.floor(v)

def decor_resource(seed,cx,cz,i):
    if not(-10001<=cx<=10001 and -10001<=cz<=10001 and 0<=i<DECOR_SLOTS):return None
    if decor_rand(seed,cx,cz,300+i)>.86:return None
    if decor_rand(seed,cx,cz,800+i)>.94:
        kind='mushroom:'+MUSHROOM_SPECIES[int(decor_rand(seed,cx,cz,1000+i)*4)]
    elif decor_rand(seed,cx,cz,900+i)>.79:
        kind='flower:'+FLOWER_SPECIES[int(decor_rand(seed,cx,cz,1100+i)*4)]
    else:
        kind='dry_grass'  # Every decorative grass tuft yields dry grass.
    x=cx*DECOR_CHUNK_SIZE+decor_rand(seed,cx,cz,100+i*2)*DECOR_CHUNK_SIZE
    z=cz*DECOR_CHUNK_SIZE+decor_rand(seed,cx,cz,101+i*2)*DECOR_CHUNK_SIZE
    if pond_depth_at(seed,x,z)>.12:return None
    return {'id':f'd:{cx},{cz}:{i}','kind':kind,'x':x,'z':z}

def nearby_decor(seed,x,z,cooldowns,now):
    cx,cz=math.floor(x/DECOR_CHUNK_SIZE),math.floor(z/DECOR_CHUNK_SIZE)
    resources=[]
    for dx in (-1,0,1):
        for dz in (-1,0,1):
            for i in range(DECOR_SLOTS):
                resource=decor_resource(seed,cx+dx,cz+dz,i)
                if resource and cooldowns.get(resource['id'],0)<=now:
                    resources.append(resource)
    return resources

def resource_info(key,seed):
    if isinstance(key,str) and key.startswith('d:'):
        try:
            cell,index=key[2:].split(':')
            cx,cz=map(int,cell.split(','))
            i=int(index)
        except (ValueError,TypeError):return None
        return decor_resource(seed,cx,cz,i)
    try:
        pair,index=key.split(':')
        zx,zz=map(int,pair.split(','))
        i=int(index)
        if not(-24001<=zx<=24001 and -24001<=zz<=24001 and 0<=i<RESOURCE_PER_ZONE):
            return None
        u,v=(resource_hash(seed,zx,zz,i,axis) for axis in (0,1))
        x=round((zx+.14+u*.72)*RESOURCE_ZONE_SIZE,2)
        z=round((zz+.14+v*.72)*RESOURCE_ZONE_SIZE,2)
        if pond_depth_at(seed,x,z)>.12:return None
        return {'id':f'{zx},{zz}:{i}',
                'kind':'branch' if resource_hash(seed,zx,zz,i,2)<.52 else 'stone',
                'x':x,'z':z}
    except (AttributeError,ValueError,TypeError):return None

def resource_cell(x,z):
    return math.floor(x/RESOURCE_ZONE_SIZE),math.floor(z/RESOURCE_ZONE_SIZE)

def resource_nearby(seed,x,z,cooldowns,now=None):
    current=time.time() if now is None else now
    cx,cz=resource_cell(x,z)
    result=[]
    for dx in range(-1,2):
        for dz in range(-1,2):
            for i in range(RESOURCE_PER_ZONE):
                info=resource_info(f'{cx+dx},{cz+dz}:{i}',seed)
                if info and cooldowns.get(info['id'],0)<=current:
                    result.append(info)
    result.extend(nearby_decor(seed,x,z,cooldowns,current))
    return result


def selected_slot(player):
    quick=player['selected']
    ref=player.get('quick_refs',[0,1,2,3])[quick]
    kind=player.get('quick_ids',['axe',None,None,None])[quick]
    if kind is None:return None
    if player['inventory'][ref] and player['inventory'][ref]['id']==kind:return ref
    if kind=='axe':return None
    return next((i for i,item in enumerate(player['inventory']) if item and item['id']==kind),None)

def refresh_equipment(player):
    slot=selected_slot(player)
    item=player['inventory'][slot] if slot is not None else None
    player['axe_equipped']=bool(item and item['id']=='axe')
    if player['axe_equipped']:player['axe_tier']=item['tier']

def transfer_inventory(player,a,b,half=False):
    inv=player['inventory']
    if not (type(a) is int and type(b) is int and
            0<=a<len(inv) and 0<=b<len(inv) and a!=b and inv[a]):return False
    src,dst=inv[a],inv[b]
    if half and src['id']!='axe' and src['count']>1:
        count=src['count']//2
        if dst and (dst['id']!=src['id'] or dst['count']+count>ITEM_LIMITS[src['id']]):return False
        src['count']-=count
        if dst:dst['count']+=count
        else:inv[b]={'id':src['id'],'count':count}
        return True
    if dst and dst['id']==src['id'] and src['id']!='axe':
        amount=min(ITEM_LIMITS[src['id']]-dst['count'],src['count'])
        if amount<=0:return False
        dst['count']+=amount
        src['count']-=amount
        if not src['count']:
            inv[a]=None
            if b not in player['quick_refs']:
                player['quick_refs']=[b if ref==a else ref for ref in player['quick_refs']]
        return True
    inv[a],inv[b]=dst,src
    player['quick_refs']=[b if n==a else a if n==b else n for n in player['quick_refs']]
    return True

def inventory_view(player):
    return {'version':1,'bagTier':player.get('bag_tier',0),
            'selectedQuick':player.get('selected',0),
            'quickRefs':player.get('quick_refs',[0,1,2,3]),'quickIds':player.get('quick_ids',['axe',None,None,None]),'slots':player['inventory']}

# Client and server use an eight-minute day, with an absolute server epoch
# persisted alongside the world. No client may set or advance the server clock.
DAY_CYCLE_SECONDS = 16 * 60
DAY_SYNC_SECONDS = 10

class World:
    def day_phase(self, now=None):
        current=time.time() if now is None else now
        return ((current-self.day_epoch)/DAY_CYCLE_SECONDS)%1

    def __init__(self,path,bot_token=""):
        self.path=Path(path);self.clients={};self.next_id=1;self.seed=random.randrange(1,999999)
        self.felled=set();self.damage={};self.logs={};self.next_log=1;self.furniture={};self.next_furniture=1;self.storages={};self.next_storage=1;self.camp_structures={};self.next_camp=1;self.boxes=BoxRegistry();self.next_box=1;self.resource_cooldowns={};self.community_cuts=0;self.chat=[];self.chat_seq=0
        self.day_epoch=time.time()
        self.world_created_at=self.day_epoch
        self.last_day_sync=time.monotonic()
        self.bots=BotManager(self);self.bot_token=bot_token
        if self.path.exists():
            try:
                data=json.loads(self.path.read_text())
                # Parse everything before committing anything; malformed saves must not
                # silently create a mixed fresh/partially restored world.
                epoch=data.get('day_epoch',self.day_epoch)
                if type(epoch) not in (int,float) or not math.isfinite(epoch) or not 0<epoch<=time.time()+DAY_CYCLE_SECONDS:
                    raise ValueError('Invalid day clock')
                seed=int(data['seed'])
                felled=set(data.get('felled',[]))
                damage={str(k):int(v) for k,v in data.get('damage',{}).items()}
                # Old length-3.6 m logs had 'level' instead of 'height'.
                # Discard them, preserve the rest of the world.
                saved_logs={int(k):v for k,v in data.get('logs',{}).items()}
                logs={k:v for k,v in saved_logs.items() if isinstance(v,dict)
                      and 'height' in v}
                outdated_logs=len(saved_logs)!=len(logs)
                for lid,log in logs.items():
                    if (not 0<lid<2147483647
                        or type(log.get('height')) is not int
                        or not 0<=log['height']<16
                        or type(log.get('orientation')) is not int
                        or log['orientation'] not in (0,1,2)
                        or any(type(log.get(axis)) not in (int,float)
                            or not math.isfinite(log[axis])
                            or abs(log[axis])>240000
                            or abs(log[axis]*2-round(log[axis]*2))>1e-4
                            for axis in ('x','z'))):
                        raise ValueError('Invalid building log')
                terrain_version=int(data.get('terrain_version',0))
                if terrain_version<3:
                    # Preserve existing structures across added water features.
                    for log in logs.values():
                        x,z=log['x'],log['z']
                        old_ground=(pond_height_before_lakes(seed,x,z) if terrain_version==2
                            else base_height(seed,x,z) if terrain_version==1 else 0.)
                        log['y']+=height_at(seed,x,z)-old_ground
                raw_furniture=data.get('furniture',{})
                if not isinstance(raw_furniture,dict):raise ValueError('Invalid furniture save')
                furniture={int(k):v for k,v in raw_furniture.items()}
                if len(furniture)>200 or any(not 1<=k<=2147483647 for k in furniture) or any(
                    not isinstance(v,dict) or v.get('kind')!='bench' or
                    not all(type(v.get(axis)) in (int,float) and math.isfinite(v[axis]) and
                            abs(v[axis])<=240000 for axis in ('x','z')) or
                    type(v.get('orientation')) is not int or v['orientation'] not in (0,1,2,3)
                    for v in furniture.values()):
                    raise ValueError('Invalid furniture save')
                raw_storages=data.get('storages',{})
                if not isinstance(raw_storages,dict) or len(raw_storages)>120:raise ValueError('Invalid storages')
                storages={int(k):v for k,v in raw_storages.items()}
                if any(not valid_storage({'id':k,**v}) or v.get('id',k)!=k for k,v in storages.items()):
                    raise ValueError('Invalid storage save')
                raw_camp=data.get('camp_structures',{})
                if not isinstance(raw_camp,dict) or len(raw_camp)>MAX_CAMP_STRUCTURES:
                    raise ValueError('Invalid camp structures')
                camp={int(k):v for k,v in raw_camp.items()}
                if any(not valid_camp_structure({'id':k,**v}) or v.get('id',k)!=k for k,v in camp.items()):
                    raise ValueError('Invalid camp structures')
                boxes_raw=data.get('boxes',{})
                if not isinstance(boxes_raw,dict) or len(boxes_raw)>MAX_GROUND_DROPS:raise ValueError('Invalid boxes')
                boxes={}
                migrated_legacy_logs=False
                for raw_id,box in boxes_raw.items():
                    ident=int(raw_id)
                    if not 0<ident<2147483647 or not isinstance(box,dict) or not valid_item(box.get('item')):raise ValueError('Invalid box')
                    if any(type(box.get(key)) not in (int,float) or not math.isfinite(box[key]) or abs(box[key])>240000
                           for key in ('x','z')):raise ValueError('Invalid box position')
                    if type(box.get('expires_at')) not in (int,float) or not math.isfinite(box['expires_at']):raise ValueError('Invalid expiry')
                    if is_fallen_logs(box):
                        if not valid_fallen_log_layout(box):
                            raise ValueError('Invalid fallen log pile')
                        if box['expires_at']==0:
                            # Legacy piles were permanent. Begin a one-hour
                            # window once and persist it to avoid resetting TTL
                            # on each server restart.
                            box={**box,'expires_at':time.time()+BOX_TTL_SECONDS}
                            migrated_legacy_logs=True
                    elif box.get('kind') is not None:
                        raise ValueError('Invalid box kind')
                    if box['expires_at']>time.time():boxes[ident]=box
                self.boxes=BoxRegistry(boxes);self.next_box=max((int(k) for k in boxes_raw),default=0)+1
                cooldown_raw=data.get('resource_cooldowns',{})
                if not isinstance(cooldown_raw,dict) or len(cooldown_raw)>100000:
                    raise ValueError('Invalid resource cooldowns')
                cooldowns={}
                for key,value in cooldown_raw.items():
                    if type(value) not in (int,float) or not math.isfinite(value):
                        raise ValueError('Invalid resource cooldown entry')
                    # A new pond may cover an old resource. Drop its cooldown,
                    # never invalidate an otherwise legitimate saved world.
                    if not re.fullmatch(r'(?:d:)?-?\d+,-?\d+:\d+',key):
                        raise ValueError('Invalid resource cooldown entry')
                    if resource_info(key,seed) is None:continue
                    if time.time()<value<=time.time()+RESOURCE_RESPAWN_SECONDS:
                        cooldowns[key]=value
                community_cuts=data.get('community_cuts',0)
                if type(community_cuts) is not int or not 0<=community_cuts<=1_000_000_000:
                    raise ValueError('Invalid community progress')
                created=data.get('world_created_at',epoch)
                if (type(created) not in (int,float) or not math.isfinite(created)
                    or not 0<created<=time.time()+DAY_CYCLE_SECONDS):
                    raise ValueError('Invalid world creation date')
                self.day_epoch=epoch
                self.world_created_at=created
                self.seed=seed;self.felled=felled;self.damage=damage;self.logs=logs;self.furniture=furniture;self.next_furniture=max(furniture,default=0)+1;self.storages=storages;self.next_storage=max(storages,default=0)+1;self.camp_structures=camp;self.next_camp=max(camp,default=0)+1;self.community_cuts=community_cuts;self.resource_cooldowns=cooldowns
                self.next_log=max(saved_logs,default=0)+1
                if migrated_legacy_logs or outdated_logs:self.save()
                print('Loaded world:',self.path)
            except (ValueError,KeyError,TypeError) as exc:print('Invalid save, starting fresh:',exc)
    def save(self):
        data={'seed':self.seed,'terrain_version':3,'felled':list(self.felled),'damage':self.damage,'logs':self.logs,'furniture':self.furniture,'storages':self.storages,'camp_structures':self.camp_structures,'boxes':self.boxes,'resource_cooldowns':self.resource_cooldowns,'community_cuts':self.community_cuts,'day_epoch':self.day_epoch,'world_created_at':self.world_created_at}
        tmp=self.path.with_suffix('.tmp');tmp.write_text(json.dumps(data));os.replace(tmp,self.path)
    def ensure_box_index(self):
        if not isinstance(self.boxes,BoxRegistry):self.boxes=BoxRegistry(self.boxes)
        return self.boxes

    def visible_box_set(self,player):
        return set(ident for ident,_ in self.ensure_box_index().nearby(
            player['x'],player['z'],AOI_RADIUS))

    async def sync_boxes(self,ws,player,force=False):
        old=player.setdefault('visible_boxes',set())
        current=self.visible_box_set(player)
        for ident in sorted(old-current):
            await self.send(ws,{'type':'box_remove','id':ident})
        for ident in sorted(current-old):
            await self.send(ws,{'type':'box_add','box':{'id':ident,**self.boxes[ident]}})
        player['visible_boxes']=current
        player['last_box_sync']=(player['x'],player['z'])

    async def prune_boxes(self,now=None):
        now=time.time() if now is None else now
        expired=self.ensure_box_index().expired(now)
        if expired:
            self.save()
            for ident in expired:await self.broadcast({'type':'box_remove','id':ident})
        return expired

    def resource_view(self,player,now=None):
        return {'type':'resources_state','resources':resource_nearby(
            self.seed,player['x'],player['z'],self.resource_cooldowns,now)}

    async def prune_resource_cooldowns(self,now=None):
        current=time.time() if now is None else now
        expired=[key for key,deadline in self.resource_cooldowns.items() if deadline<=current]
        if not expired:return []
        for key in expired:del self.resource_cooldowns[key]
        self.save()
        for ws,player in list(self.clients.items()):
            cx,cz=resource_cell(player['x'],player['z'])
            dcx,dcz=(math.floor(player[axis]/DECOR_CHUNK_SIZE) for axis in ('x','z'))
            if any(
                (abs(int(key[2:].split(':')[0].split(',')[0])-dcx)<=1
                 and abs(int(key[2:].split(':')[0].split(',')[1])-dcz)<=1)
                 if key.startswith('d:') else
                (abs(int(key.split(':')[0].split(',')[0])-cx)<=1
                 and abs(int(key.split(':')[0].split(',')[1])-cz)<=1)
                for key in expired):
                await self.send(ws,self.resource_view(player,current))
        return expired

    async def handle_death(self,ws,player):
        # Keep all items if the world is full; retry when boxes expire.
        if player['health']>0:return False
        await self.prune_boxes()
        slots=[v.copy() for v in player['inventory'] if v]
        if len(self.boxes)+len(slots)>MAX_GROUND_DROPS:
            await self.send(ws,{'type':'action_denied',
                'reason':'Недостаточно места для вещей. Смерть отложена, инвентарь сохранён.'})
            return False
        x,z=player['x'],player['z']
        expires=time.time()+BOX_TTL_SECONDS
        for i,item in enumerate(slots):
            angle=i*2.399963229728653
            radius=.8+.39*math.sqrt(i)
            box={'x':round(x+math.cos(angle)*radius,2),
                 'z':round(z+math.sin(angle)*radius,2),
                 'expires_at':expires,'item':item}
            ident=self.next_box;self.next_box+=1
            self.boxes[ident]=box
            await self.broadcast({'type':'box_add','box':{'id':ident,**box}})
        player['inventory'][:]=[None]*len(player['inventory'])
        player['wood']=0
        refresh_equipment(player)
        bed=self.camp_structures.get(player.get('spawn_bed'))
        if bed and bed['kind']=='bed':
            player['x']=bed['x']+2.5;player['z']=bed['z']
        else:
            player['x']=player['z']=0
            player['spawn_bed']=None
        player['y']=height_at(self.seed,player['x'],player['z'])
        player['health']=MAX_VITALS;player['hunger']=3
        player['stamina']=float(MAX_VITALS)
        player['hunger_progress']=0;player['starvation_progress']=0
        player['last_hunger_at']=time.monotonic()
        player['last_stamina_at']=time.monotonic()
        player['stamina_sprint_locked']=False;player['sprinting']=False
        player['fall_peak']=None
        player['last_effect_ids']=frozenset()
        for key in STATUS_PLAYER_KEYS.values():player.pop(key,None)
        await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':0})
        await self.send(ws,{'type':'vitals_state','vitals':vitals_view(player)})
        await self.send(ws,{'type':'player_respawn','x':player['x'],'z':player['z'],
          'marker':{'x':x,'z':z,'expires_at':expires}})
        await self.sync_boxes(ws,player)
        await self.broadcast({'type':'equipment','by':player['id'],'axe_equipped':False})
        await self.broadcast({'type':'move','id':player['id'],
          'x':player['x'],'z':player['z'],'y':player['y'],'yaw':player['yaw'],
          'jumping':False},ws)
        self.save()
        return True

    async def box_expiration_loop(self):
        while True:
            await asyncio.sleep(1)
            await self.prune_boxes()
            await self.prune_resource_cooldowns()
            current=time.monotonic()
            if current-self.last_day_sync>=DAY_SYNC_SECONDS:
                self.last_day_sync=current
                await self.broadcast({'type':'time_sync','day_phase':self.day_phase()})
            for ws,player in list(self.clients.items()):
                # No continued sprint drain after the last movement packet.
                if current-player['last_pos']>.35:player['sprinting']=False
                stamina_changed=advance_stamina(player,current)
                hunger_changed=advance_hunger(player,current)
                if player['health']==0:
                    if await self.handle_death(ws,player):continue
                # Status expiry is authoritative too: notify even idle players
                # whose health/hunger/stamina remain unchanged at full bars.
                current_statuses=active_status_ids(player)
                status_changed=current_statuses!=player.get('last_effect_ids',frozenset())
                if status_changed:player['last_effect_ids']=current_statuses
                if status_changed or hunger_changed or (stamina_changed and
                    current-player.get('last_stamina_sent',0)>=.6):
                    player['last_stamina_sent']=current
                    await self.send(ws,{'type':'vitals_state','vitals':vitals_view(player)})

    async def send(self,ws,data):
        try:await ws.send(json.dumps(data,separators=(',',':')))
        except Exception:pass
    async def broadcast(self,data,except_ws=None):
        if data.get('type')=='box_add':
            box=data['box'];ident=box['id']
            sends=[]
            for ws,p in self.clients.items():
                if ws==except_ws:continue
                tracked=p.setdefault('visible_boxes',set())
                relevant=math.hypot(p['x']-box['x'],p['z']-box['z'])<=AOI_RADIUS
                if relevant:
                    tracked.add(ident)
                    sends.append(self.send(ws,data))
                elif ident in tracked:
                    tracked.remove(ident)
                    sends.append(self.send(ws,{'type':'box_remove','id':ident}))
            if sends:await asyncio.gather(*sends)
            return
        if data.get('type')=='box_remove':
            ident=data['id'];sends=[]
            for ws,p in self.clients.items():
                tracked=p.setdefault('visible_boxes',set())
                if ident in tracked:
                    tracked.remove(ident)
                    if ws!=except_ws:sends.append(self.send(ws,data))
            if sends:await asyncio.gather(*sends)
            return
        if self.clients:
            await asyncio.gather(*(self.send(ws,data) for ws in list(self.clients)
                                  if ws!=except_ws))
    async def bot_handler(self,ws):
        # Minimal experimental authentication: a configured token is required remotely.
        remote=ws.remote_address[0] if ws.remote_address else ''
        if not self.bot_token and remote not in ('127.0.0.1','::1'):
            await ws.close(1008,'Bot API requires a token for remote access');return
        bot=None
        try:
            async for raw in ws:
                if len(raw)>MAX_MESSAGE:continue
                try:req=json.loads(raw)
                except (ValueError,TypeError):continue
                if not isinstance(req,dict):continue
                rid=req.get('request_id')
                op=req.get('op')
                try:
                    if not bot and op!='register':raise ValueError('Register first')
                    if op=='register':
                        if self.bot_token and req.get('token')!=self.bot_token:raise ValueError('Invalid bot token')
                        if bot:result={'id':bot['id'],'name':bot['name']}
                        else:
                            bot=await self.bots.create(req.get('name','AI Lumberjack'))
                            result={'id':bot['id'],'name':bot['name']}
                    elif op=='observe':result=self.bots.observe(bot,req.get('radius',30),req.get('limit',12))
                    elif op in ('brief','status'):result=self.bots.brief(bot,req.get('after_chat_id',0))
                    elif op=='startTask':result=self.bots.start(bot,req.get('task'),req.get('params') or {})
                    elif op=='startFollowing':result=self.bots.start(bot,'followPlayer',{'playerId':req.get('player_id')})
                    elif op=='stopFollowing':
                        if bot['task'] and bot['task']['type']=='followPlayer':result=self.bots.stop(bot)
                        else:result={'status':'not_following'}
                    elif op=='cancelTask':result=self.bots.stop(bot)
                    elif op=='getTask':
                        task=bot['task'] or bot['last_task']
                        result=self.bots.task_view(bot) if bot['task'] else task
                        if req.get('id') is not None and result and result['id']!=int(req['id']):result=None
                    elif op=='getActiveTask':result=self.bots.task_view(bot)
                    elif op=='say':
                        message=str(req.get('text','')).strip()[:400]
                        if not message:raise ValueError('Empty chat message')
                        self.chat_seq+=1
                        entry={'id':self.chat_seq,'type':'chat','from':bot['id'],'name':bot['name'],
                               'text':message,'timestamp':int(time.time()*1000)}
                        self.chat.append(entry);self.chat=self.chat[-80:]
                        await self.broadcast(entry);result={'sent':True,'id':self.chat_seq}
                    else:raise ValueError('Unknown operation')
                    answer={'request_id':rid,'ok':True,'result':result}
                except (ValueError,TypeError,OverflowError) as exc:
                    answer={'request_id':rid,'ok':False,'error':str(exc)}
                await self.send(ws,answer)
        except ConnectionClosed:
            pass
        finally:
            if bot:await self.bots.remove(bot['id'])

    async def hit_tree(self,player,uid_key,now,damage=1):
        key=str(uid_key)
        info=tree_info(key,self.seed)
        if not info or key in self.felled or math.hypot(player['x']-info[0],player['z']-info[1])>6.5:
            return False
        hp=self.damage.get(key,info[2])-damage
        if hp<=0:
            # Persist the loot before reporting the tree felled. A full backpack
            # cannot discard any resources; pickup is a separate transaction.
            if len(self.boxes)>=MAX_GROUND_DROPS:
                self.damage[key]=1
                await self.broadcast({'type':'tree_hit','tree':key,'hp':1,'by':player['id']})
                for ws,client in self.clients.items():
                    if client is player:
                        await self.send(ws,{'type':'action_denied',
                                            'reason':'На земле слишком много предметов — сначала подбери часть'})
                self.save()
                return False
            ident=self.next_box;self.next_box+=1
            direction=math.atan2(player['x']-info[0],player['z']-info[1])+math.pi
            box=fallen_logs_box(info[0],info[1],direction=direction,
                                tree=key,ready_at=time.time()+FALL_DURATION)
            self.boxes[ident]=box
            self.felled.add(key);self.damage.pop(key,None)
            player['cuts']+=1;self.community_cuts+=1
            await self.broadcast({'type':'tree_fell','tree':key,'by':player['id'],
                                  'wood':player['wood'],'cuts':player['cuts'],'community_cuts':self.community_cuts,'direction':direction})
            await self.broadcast({'type':'box_add','box':{'id':ident,**box}})
        else:
            self.damage[key]=hp
            await self.broadcast({'type':'tree_hit','tree':key,'hp':hp,'by':player['id']})
        self.save()
        return True

    async def collect_bot_fallen_logs(self,bot,key):
        # An autonomous harvesting bot physically gathers the new pile after
        # felling. Ordinary chopTree tasks leave all three logs for players.
        info=tree_info(key,self.seed)
        if not info:return 0
        for ident,box in self.boxes.items():
            if not is_fallen_logs(box) or box['expires_at']<=time.time() or math.hypot(box['x']-info[0],box['z']-info[1])>.01:
                continue
            if math.hypot(bot['x']-box['x'],bot['z']-box['z'])>2.8:return 0
            count=box['item']['count']
            bot['wood']+=count
            del self.boxes[ident]
            await self.broadcast({'type':'box_remove','id':ident})
            self.save()
            return count
        return 0

    def server_status(self):
        return {'type':'server_status','name':'Forest Chopper Server',
                'online':len(self.clients),'max_players':32,
                'world_seed':self.seed,'world_created_at':self.world_created_at,
                'day_phase':self.day_phase(),'protocol_version':1}

    async def handler(self,ws):
        path=ws.request.path.split('?',1)[0]
        if path=='/status':
            await self.send(ws,self.server_status())
            await ws.close()
            return
        if path=='/bots':
            await self.bot_handler(ws);return
        if len(self.clients)+len(self.bots.bots)>=32:await ws.close(1013,'Server full');return
        uid=self.next_id;self.next_id+=1
        player={'id':uid,'name':f'Игрок {uid}','x':0,'z':0,'y':height_at(self.seed,0,0),'yaw':0,'jumping':False,'wood':0,'cuts':0,'last_hit':0,'last_pos':time.monotonic(),'last_build':0,'last_chat':0,'last_map_ping':0,'last_emote':0,'axe_equipped':True,'axe_tier':0,'wood_capacity':DEFAULT_WOOD_CAPACITY,'inventory':new_inventory(),'selected':0,'quick_refs':[0,1,2,3],'quick_ids':['axe',None,None,None],'bag_tier':0,'health':MAX_VITALS,'hunger':MAX_VITALS,'hunger_progress':0.0,'starvation_progress':0.0,'last_hunger_at':time.monotonic(),'stamina':float(MAX_VITALS),'last_stamina_at':time.monotonic(),'stamina_sprint_locked':False,'sprinting':False,'last_stamina_sent':0,'spawn_bed':None,'last_jump':-10000,'jump_authorized_until':0}
        self.clients[ws]=player
        await self.prune_boxes()
        player['visible_boxes']=self.visible_box_set(player)
        player['last_box_sync']=(player['x'],player['z'])
        await self.send(ws,{'type':'welcome','id':uid,'seed':self.seed,'day_phase':self.day_phase(),'felled':list(self.felled),'damage':self.damage,'logs':[{'id':k,**v} for k,v in self.logs.items()],'furniture':[{'id':k,**v} for k,v in self.furniture.items()],'storages':list(self.storages.values()),'camp_structures':[{'id':k,**v} for k,v in self.camp_structures.items()],'players':[{k:v for k,v in p.items() if k in ('id','name','x','z','y','yaw','jumping','axe_equipped')} for w,p in self.clients.items() if w!=ws]+[self.bots.player_data(b) for b in self.bots.players()],'wood':0,'cuts':0,'inventory':inventory_view(player),'vitals':vitals_view(player),'boxes':[{'id':k,**self.boxes[k]} for k in sorted(player['visible_boxes'])],'resources':self.resource_view(player)['resources'],'community_cuts':self.community_cuts,'chat':self.chat[-40:]})
        try:
            async for raw in ws:
                if len(raw)>MAX_MESSAGE:continue
                try:data=json.loads(raw)
                except (ValueError,TypeError):continue
                if not isinstance(data,dict):continue
                kind=data.get('type');now=time.monotonic()
                if kind=='collect_resource':
                    ident=data.get('id')
                    if not isinstance(ident,str) or len(ident)>40:continue
                    resource=resource_info(ident,self.seed)
                    if resource is None or resource['id']!=ident:continue
                    if ident.startswith('d:'):
                        cx,cz=(math.floor(player[axis]/DECOR_CHUNK_SIZE) for axis in ('x','z'))
                        rx,rz=(math.floor(resource[axis]/DECOR_CHUNK_SIZE) for axis in ('x','z'))
                    else:
                        cx,cz=resource_cell(player['x'],player['z'])
                        rx,rz=resource_cell(resource['x'],resource['z'])
                    if abs(rx-cx)>1 or abs(rz-cz)>1:continue
                    if math.hypot(player['x']-resource['x'],player['z']-resource['z'])>2.5:continue
                    if self.resource_cooldowns.get(ident,0)>time.time():continue
                    if not inv_add(player['inventory'],{'id':resource['kind'],'count':1}):
                        await self.send(ws,{'type':'action_denied','reason':inv_capacity_reason(player['inventory'],{'id':resource['kind'],'count':1})});continue
                    self.resource_cooldowns[ident]=time.time()+RESOURCE_RESPAWN_SECONDS
                    self.save()
                    await self.broadcast({'type':'resource_remove','id':ident})
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                elif kind=='craft_structure':
                    typ=data.get('recipe')
                    cost=STRUCTURE_RECIPES.get(typ) if isinstance(typ,str) else None
                    if cost is None:continue
                    inv=player['inventory']
                    if not all(inv_count(inv,k)>=n for k,n in cost.items()):continue
                    before=[it.copy() if it else None for it in inv]
                    for ingredient,n in cost.items():inv_take(inv,ingredient,n)
                    if not inv_add(inv,{'id':typ,'count':1}):
                        player['inventory']=before
                        await self.send(ws,{'type':'action_denied','reason':inv_capacity_reason(before,{'id':typ,'count':1})});continue
                    player['wood']=inv_count(inv,'log')
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                    self.save()
                elif kind=='camp_place':
                    typ=data.get('kind')
                    if typ not in CAMP_RECIPES or len(self.camp_structures)>=MAX_CAMP_STRUCTURES:continue
                    x,z,orientation=data.get('x'),data.get('z'),data.get('orientation',0)
                    if type(x) not in (int,float) or type(z) not in (int,float) or type(orientation) is not int:continue
                    if not math.isfinite(x) or not math.isfinite(z) or orientation not in range(4):continue
                    if abs(x)>240000 or abs(z)>240000 or math.hypot(x-player['x'],z-player['z'])>5:continue
                    if pond_depth_at(self.seed,x,z)>.12 or any(
                        math.hypot(x-st['x'],z-st['z'])<2.4
                        for st in list(self.storages.values())+list(self.camp_structures.values())):continue
                    slot=selected_slot(player)
                    equipped=player['inventory'][slot] if slot is not None else None
                    if not equipped or equipped['id']!=typ:continue
                    if not inv_take(player['inventory'],typ,1):continue
                    ident=self.next_camp;self.next_camp+=1
                    placed={'id':ident,'kind':typ,'x':x,'z':z,'orientation':orientation,'lit':False}
                    self.camp_structures[ident]={k:v for k,v in placed.items() if k!='id'}
                    await self.broadcast({'type':'camp_add','structure':placed})
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                    self.save()
                elif kind=='camp_toggle':
                    ident=data.get('id')
                    if type(ident) is not int or ident not in self.camp_structures:continue
                    item=self.camp_structures[ident]
                    if item['kind'] not in ('campfire','torch') or math.hypot(item['x']-player['x'],item['z']-player['z'])>3.2:continue
                    item['lit']=not item['lit']
                    await self.broadcast({'type':'camp_update','structure':{'id':ident,**item}})
                    self.save()
                elif kind=='storage_place':
                    typ=data.get('kind')
                    if typ not in STORAGE_COST or len(self.storages)>=120:continue
                    x,z=data.get('x'),data.get('z')
                    if type(x) not in (int,float) or type(z) not in (int,float) or not math.isfinite(x) or not math.isfinite(z):continue
                    if abs(x)>240000 or abs(z)>240000 or math.hypot(x-player['x'],z-player['z'])>5:continue
                    if pond_depth_at(self.seed,x,z)>.12 or any(math.hypot(x-st['x'],z-st['z'])<2.4 for st in list(self.storages.values())+list(self.camp_structures.values())):continue
                    slot=selected_slot(player)
                    equipped=player['inventory'][slot] if slot is not None else None
                    if not equipped or equipped['id']!=typ:continue
                    if not inv_take(player['inventory'],typ,1):continue
                    storage=new_storage(typ,self.next_storage,x,z)
                    self.next_storage+=1;self.storages[storage['id']]=storage
                    await self.broadcast({'type':'storage_update','storage':storage})
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                    self.save()
                elif kind=='storage_transfer':
                    ident=data.get('id')
                    if type(ident) is not int or ident not in self.storages:continue
                    storage=self.storages[ident]
                    if math.hypot(storage['x']-player['x'],storage['z']-player['z'])>3.2:continue
                    if not storage_transfer(player,storage,data.get('direction'),data.get('slot'),data.get('qty',1)):
                        await self.send(ws,{'type':'action_denied','reason':'Недостаточно места, веса или предметов'});continue
                    refresh_equipment(player)
                    await self.broadcast({'type':'storage_update','storage':storage})
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                    self.save()
                elif kind=='storage_move':
                    ident=data.get('id')
                    if type(ident) is not int or ident not in self.storages:continue
                    storage=self.storages[ident]
                    if math.hypot(storage['x']-player['x'],storage['z']-player['z'])>3.2:continue
                    if not storage_move_slot(player,storage,data.get('fromArea'),data.get('from'),
                                             data.get('toArea'),data.get('to'),data.get('half',False)):
                        await self.send(ws,{'type':'action_denied','reason':'Невозможно перенести: слот, вес или лимит'})
                        continue
                    refresh_equipment(player)
                    await self.broadcast({'type':'storage_update','storage':storage})
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                    self.save()
                elif kind=='storage_rename':
                    ident,name=data.get('id'),data.get('name')
                    if type(ident) is not int or ident not in self.storages or not isinstance(name,str):continue
                    storage=self.storages[ident]
                    if storage['kind']!='chest' or math.hypot(storage['x']-player['x'],storage['z']-player['z'])>3.2:continue
                    name=name.strip()[:40]
                    if not name:continue
                    storage['name']=name
                    await self.broadcast({'type':'storage_update','storage':storage})
                    self.save()
                elif kind=='drop_item':
                    slot=data.get('slot')
                    if type(slot) is not int or not 0<=slot<len(player['inventory']) or len(self.boxes)>=MAX_GROUND_DROPS:continue
                    item=player['inventory'][slot]
                    if not valid_item(item):continue
                    x=round(player['x']-math.sin(player['yaw'])*1.5,2)
                    z=round(player['z']-math.cos(player['yaw'])*1.5,2)
                    ident=self.next_box;self.next_box+=1
                    box={'x':x,'z':z,'expires_at':time.time()+BOX_TTL_SECONDS,'item':item.copy()}
                    self.boxes[ident]=box;player['inventory'][slot]=None
                    if item['id']=='log':player['wood']-=item['count']
                    refresh_equipment(player)
                    await self.broadcast({'type':'equipment','by':uid,'axe_equipped':player['axe_equipped']})
                    await self.broadcast({'type':'box_add','box':{'id':ident,**box}})
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                    self.save()
                elif kind=='pickup_box':
                    ident=data.get('id')
                    if type(ident) is not int:continue
                    box=self.boxes.get(ident)
                    if not box or box['expires_at']<=time.time():continue
                    segment=None
                    if is_fallen_logs(box):
                        if box.get('ready_at',0)>time.time():continue
                        parts=fallen_log_segments(box)
                        selected=data.get('segment')
                        if selected is not None:
                            if type(selected) is not int:continue
                            part=next((p for p in parts if p[0]==selected),None)
                        else:
                            part=min(parts,key=lambda p:math.hypot(player['x']-p[1],player['z']-p[2]),default=None)
                        if part is None or math.hypot(player['x']-part[1],player['z']-part[2])>2.8:continue
                        segment=part[0]
                    elif math.hypot(player['x']-box['x'],player['z']-box['z'])>2.8:continue
                    # Pick exactly one fixed segment: atomic, authoritative and
                    # independent of the other remaining segments.
                    received={'id':'log','count':1} if is_fallen_logs(box) else box['item']
                    if not inv_add(player['inventory'],received):
                        await self.send(ws,{'type':'action_denied','reason':inv_capacity_reason(player['inventory'],received)});continue
                    if received['id']=='log':player['wood']+=received['count']
                    if is_fallen_logs(box) and box['item']['count']>1:
                        box['mask']=fallen_log_mask(box)&~(1<<segment)
                        box['item']['count']-=1
                        await self.broadcast({'type':'box_add','box':{'id':ident,**box}})
                    else:
                        del self.boxes[ident]
                        await self.broadcast({'type':'box_remove','id':ident})
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                    self.save()
                elif kind=='trash_item':
                    slot=data.get('slot')
                    if type(slot) is not int or not 0<=slot<len(player['inventory']):continue
                    item=player['inventory'][slot]
                    if not valid_item(item):continue
                    player['inventory'][slot]=None
                    if item['id']=='log':player['wood']-=item['count']
                    refresh_equipment(player)
                    await self.broadcast({'type':'equipment','by':uid,'axe_equipped':player['axe_equipped']})
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                elif kind=='craft_potion':
                    name=data.get('recipe')
                    if name in POTION_RECIPES:
                        cost=POTION_RECIPES[name];station='alchemy_table'
                    elif name in FOOD_RECIPES:
                        cost=FOOD_RECIPES[name];station='campfire'
                    else:continue
                    if not has_crafting_station(self.camp_structures,station,player['x'],player['z']):
                        await self.send(ws,{'type':'action_denied','reason':'Нужна станция крафта в пределах 10 м'})
                        continue
                    inv=player['inventory']
                    if not all(inv_count(inv,ingredient)>=amount for ingredient,amount in cost.items()):continue
                    snapshot=[entry.copy() if entry else None for entry in inv]
                    for ingredient,amount in cost.items():inv_take(inv,ingredient,amount)
                    if not inv_add(inv,{'id':name,'count':1}):
                        player['inventory']=snapshot
                        await self.send(ws,{'type':'action_denied','reason':'Недостаточно места или веса'});continue
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                elif kind=='bed_spawn':
                    ident=data.get('id')
                    bed=self.camp_structures.get(ident) if type(ident) is int else None
                    if bed and bed['kind']=='bed' and math.hypot(
                      player['x']-bed['x'],player['z']-bed['z'])<=3.2:
                        player['spawn_bed']=ident
                        await self.send(ws,{'type':'spawn_bed_set','id':ident})
                elif kind=='consume_food':
                    slot=data.get('slot')
                    if type(slot) is not int or not 0<=slot<len(player['inventory']):continue
                    item=player['inventory'][slot]
                    if not item or item['id'] not in FOOD_EFFECTS or item.get('count',0)<1:continue
                    advance_hunger(player,now)
                    player['inventory'][slot]['count']-=1
                    if player['inventory'][slot]['count']==0:player['inventory'][slot]=None
                    apply_food(player,item['id'])
                    player['last_effect_ids']=active_status_ids(player)
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                    await self.send(ws,{'type':'vitals_state','vitals':vitals_view(player)})
                    if player['health']==0:await self.handle_death(ws,player)
                elif kind=='craft_axe':
                    inv=player['inventory']
                    if inv_count(inv,'branch')<3 or inv_count(inv,'stone')<2:
                        await self.send(ws,{'type':'action_denied','reason':'Нужно 3 ветки и 2 камня'});continue
                    snapshot=[x.copy() if x else None for x in inv]
                    inv_take(inv,'branch',3);inv_take(inv,'stone',2)
                    if not inv_add(inv,{'id':'axe','tier':0}):
                        player['inventory']=snapshot
                        await self.send(ws,{'type':'action_denied','reason':inv_capacity_reason(player['inventory'],{'id':'axe','tier':0})});continue
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                elif kind=='hello':
                    player['name']=str(data.get('name','Игрок'))[:22].strip() or f'Игрок {uid}'
                    await self.broadcast({'type':'join','player':{k:player[k] for k in ('id','name','x','z','y','yaw','jumping','axe_equipped')}},ws)
                elif kind=='ping':
                    # Application-level RTT for browser clients; WebSocket control pings
                    # are not exposed to client-side JavaScript. Never broadcast it.
                    nonce=data.get('nonce')
                    if type(nonce) is int and 0<=nonce<=2147483647:
                        await self.send(ws,{'type':'pong','nonce':nonce})
                elif kind=='map_ping':
                    # Ephemeral co-op marker. The server validates sender/range and never persists it.
                    if now-player['last_map_ping']<2:continue
                    try:x=float(data['x']);z=float(data['z'])
                    except (ValueError,KeyError,TypeError,OverflowError):continue
                    if not math.isfinite(x) or not math.isfinite(z):continue
                    if abs(x)>240000 or abs(z)>240000 or math.hypot(x-player['x'],z-player['z'])>55:continue
                    player['last_map_ping']=now
                    await self.broadcast({'type':'map_ping','by':uid,'name':player['name'],
                                          'x':round(x,1),'z':round(z,1)})
                elif kind=='emote':
                    mood=data.get('kind')
                    if mood not in ('wave','thumbs_up') or now-player['last_emote']<1.5:continue
                    player['last_emote']=now
                    await self.broadcast({'type':'emote','by':uid,'kind':mood})
                elif kind=='chat':
                    message=data.get('text')
                    if not isinstance(message,str):continue
                    message=message.strip()[:400]
                    if not message or now-player['last_chat']<.35:continue
                    player['last_chat']=now
                    self.chat_seq+=1
                    entry={'id':self.chat_seq,'type':'chat','from':uid,'name':player['name'],'text':message,'timestamp':int(time.time()*1000)}
                    self.chat.append(entry)
                    self.chat=self.chat[-80:]
                    await self.broadcast(entry)
                elif kind=='jump':
                    advance_stamina(player,now)
                    if (now-player['last_jump']<.6 or player['jumping']
                        or player['stamina']<STAMINA_JUMP_COST):
                        await self.send(ws,{'type':'vitals_state','vitals':vitals_view(player)})
                        await self.send(ws,{'type':'action_denied','reason':'Нет сил' if player['stamina']<STAMINA_JUMP_COST else 'Прыжок недоступен'})
                        continue
                    player['stamina']=max(0,player['stamina']-STAMINA_JUMP_COST)
                    if player['stamina']<=0:player['stamina_sprint_locked']=True
                    player['last_jump']=now
                    player['jump_authorized_until']=now+1.5
                    player['last_stamina_sent']=now
                    await self.send(ws,{'type':'vitals_state','vitals':vitals_view(player)})
                elif kind=='move':
                    try:x=float(data['x']);z=float(data['z']);yaw=float(data['yaw']);y=float(data.get('y',0));jumping=bool(data.get('jumping',False))
                    except (ValueError,KeyError,TypeError):continue
                    if not all(map(math.isfinite,(x,z,yaw,y))) or abs(x)>240000 or abs(z)>240000:continue
                    ground=height_at(self.seed,x,z)
                    if y<ground-.35 or y>ground+12:continue
                    dt=max(.05,now-player['last_pos']);distance=math.hypot(x-player['x'],z-player['z'])
                    if distance>max(4,dt*11) or not can_stand(self,x,z,y):continue
                    if jumping and y>player['y']+.08 and now>player['jump_authorized_until']:
                        continue
                    stamina_changed=advance_stamina(player,now)
                    wants_sprint=data.get('sprinting') is True and distance>.005
                    permitted_sprint=wants_sprint and server_can_sprint(player)
                    if permitted_sprint:
                        player['walk_credit']=.45
                    else:
                        # Small burst allowance for packet jitter, bounded over time
                        # so exhausted players cannot bypass walking speed by
                        # sending numerous tiny movement packets.
                        credit=min(.45,player.get('walk_credit',.45)+3.7*dt)-distance
                        if credit<-1e-6:
                            player['sprinting']=False
                            await self.send(ws,{'type':'vitals_state','vitals':vitals_view(player)})
                            continue
                        player['walk_credit']=credit
                    player['sprinting']=permitted_sprint
                    old_x,old_z=player['x'],player['z']
                    impact=record_fall_landing(player,player['y'],y,jumping)
                    player.update(x=x,z=z,y=y,yaw=yaw,jumping=jumping,last_pos=now)
                    if impact:
                        drop,damage=impact
                        player['health']=max(0,player['health']-damage)
                        if player['health']==0:
                            await self.handle_death(ws,player)
                            continue
                        await self.send(ws,{'type':'vitals_state','vitals':vitals_view(player)})
                        await self.send(ws,{'type':'fall_impact',
                            'height':round(drop,3),'damage':damage})
                    ox,oz=player.get('last_box_sync',(0,0))
                    if math.hypot(x-ox,z-oz)>=12:
                        await self.sync_boxes(ws,player)
                    if stamina_changed and now-player['last_stamina_sent']>.6:
                        player['last_stamina_sent']=now
                        await self.send(ws,{'type':'vitals_state','vitals':vitals_view(player)})
                    await self.broadcast({'type':'move','id':uid,'x':x,'z':z,'y':y,'yaw':yaw,'jumping':jumping},ws)
                    if (resource_cell(x,z)!=resource_cell(old_x,old_z) or
                        math.floor(x/DECOR_CHUNK_SIZE)!=math.floor(old_x/DECOR_CHUNK_SIZE) or
                        math.floor(z/DECOR_CHUNK_SIZE)!=math.floor(old_z/DECOR_CHUNK_SIZE)):
                        await self.send(ws,self.resource_view(player))
                elif kind=='equip':
                    if data.get('item') not in ('axe',None):continue
                    refresh_equipment(player)
                    await self.broadcast({'type':'equipment','by':uid,'axe_equipped':player['axe_equipped']})
                elif kind=='select_slot':
                    slot=data.get('slot')
                    if type(slot) is not int or not 0<=slot<4:continue
                    player['selected']=slot
                    refresh_equipment(player)
                    await self.broadcast({'type':'equipment','by':uid,'axe_equipped':player['axe_equipped']})
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                elif kind=='move_slot':
                    a,b=data.get('from'),data.get('to')
                    if type(a) is not int or type(b) is not int or not(0<=a<len(player['inventory']) and 0<=b<len(player['inventory'])):continue
                    if not transfer_inventory(player,a,b):continue
                    refresh_equipment(player)
                    await self.broadcast({'type':'equipment','by':uid,'axe_equipped':player['axe_equipped']})
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                elif kind=='transfer_slot':
                    a,b=data.get('from'),data.get('to')
                    if not transfer_inventory(player,a,b,data.get('half') is True):continue
                    refresh_equipment(player)
                    await self.broadcast({'type':'equipment','by':uid,'axe_equipped':player['axe_equipped']})
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                elif kind=='split_slot':
                    slot=data.get('slot')
                    if type(slot) is not int or not 0<=slot<len(player['inventory']):continue
                    target=next((i for i,item in enumerate(player['inventory']) if item is None),None)
                    if target is None or not transfer_inventory(player,slot,target,True):continue
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                elif kind=='assign_quick':
                    quick,source=data.get('quick'),data.get('source')
                    if type(quick) is not int or not 0<=quick<4 or type(source) is not int or not 0<=source<len(player['inventory']):continue
                    refs=player['quick_refs']
                    old=refs[quick]
                    kinds=player['quick_ids']
                    old_kind=kinds[quick]
                    other=refs.index(source) if source in refs else -1
                    refs[quick]=source
                    kinds[quick]=player['inventory'][source]['id'] if player['inventory'][source] else None
                    if other>=0 and other!=quick:
                        refs[other]=old
                        kinds[other]=old_kind
                    refresh_equipment(player)
                    await self.broadcast({'type':'equipment','by':uid,'axe_equipped':player['axe_equipped']})
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                elif kind=='swap_quick':
                    a,b=data.get('from'),data.get('to')
                    if type(a) is not int or type(b) is not int or not 0<=a<4 or not 0<=b<4:continue
                    player['quick_refs'][a],player['quick_refs'][b]=player['quick_refs'][b],player['quick_refs'][a]
                    player['quick_ids'][a],player['quick_ids'][b]=player['quick_ids'][b],player['quick_ids'][a]
                    refresh_equipment(player)
                    await self.broadcast({'type':'equipment','by':uid,'axe_equipped':player['axe_equipped']})
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                elif kind=='craft_item':
                    if data.get('recipe')!='bench' or player['wood']<3 or None not in player['inventory']:
                        await self.send(ws,{'type':'action_denied','reason':'Нужно 3 бревна и свободный слот'});continue
                    snapshot=[item.copy() if item else None for item in player['inventory']]
                    if not inv_take_logs(player['inventory'],3):continue
                    if not inv_add_bench(player['inventory']):
                        player['inventory']=snapshot
                        await self.send(ws,{'type':'action_denied','reason':'Сумка заполнена'});continue
                    player['wood']-=3
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                    self.save()
                elif kind=='place_item':
                    if now-player['last_build']<.12:continue
                    slot=selected_slot(player)
                    item=player['inventory'][slot] if slot is not None else None
                    if item is None or item['id'] not in ('log','bench'):continue
                    try:x=float(data['x']);z=float(data['z']);orientation=int(data['orientation'])
                    except (ValueError,KeyError,TypeError,OverflowError):continue
                    if not math.isfinite(x) or not math.isfinite(z) or orientation not in ((0,1,2) if item['id']=='log' else (0,1,2,3)) or math.hypot(x-player['x'],z-player['z'])>6:continue
                    if abs(x)>240000 or abs(z)>240000 or abs(x*2-round(x*2))>1e-4 or abs(z*2-round(z*2))>1e-4:continue
                    if pond_depth_at(self.seed,x,z)>.2:continue
                    if item['id']=='log':
                        height=data.get('height')
                        if type(height) is not int or not 0<=height<16:continue
                        p={'x':x,'z':z,'orientation':orientation,'height':height,
                           'y':height_at(self.seed,x,z)+(.29 if orientation!=2 else 1.5)+height*.5}
                        if any(v['x']==x and v['z']==z and v['height']==height
                               and v['orientation']==orientation for v in self.logs.values()):continue
                        if not inv_take_logs(player['inventory'],1):continue
                        player['wood']-=1
                        lid=self.next_log;self.next_log+=1;self.logs[lid]=p
                        await self.broadcast({'type':'log_add','log':{'id':lid,**p},'by':uid,'wood':player['wood']})
                    else:
                        if len(self.furniture)>=200 or not can_stand(self,x,z,height_at(self.seed,x,z)):continue
                        if any(math.hypot(x-v['x'], z-v['z'])<2.5 for v in self.furniture.values()):continue
                        player['inventory'][slot]=None
                        item={'kind':'bench','x':x,'z':z,'orientation':orientation}
                        fid=self.next_furniture;self.next_furniture+=1;self.furniture[fid]=item
                        await self.broadcast({'type':'furniture_add','item':{'id':fid,**item},'by':uid,'wood':player['wood']})
                    player['last_build']=now
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                    self.save()
                elif kind=='hit_structure':
                    if not player['axe_equipped'] or now-player['last_build']<.3:continue
                    typ=data.get('kind')
                    try:ident=int(data['id'])
                    except (KeyError,TypeError,ValueError,OverflowError):continue
                    if typ=='bench':
                        old=self.furniture.get(ident)
                        if old is None or math.hypot(old['x']-player['x'],old['z']-player['z'])>6:continue
                        if not inv_add_bench(player['inventory']):
                            await self.send(ws,{'type':'action_denied','reason':inv_capacity_reason(player['inventory'],{'id':'bench','count':1})});continue
                        del self.furniture[ident]
                        await self.broadcast({'type':'furniture_remove','id':ident,'by':uid,'wood':player['wood']})
                    elif typ=='camp':
                        old=self.camp_structures.get(ident)
                        if old is None or math.hypot(old['x']-player['x'],old['z']-player['z'])>6:continue
                        reward={'id':old['kind'],'count':1}
                        if not inv_add(player['inventory'],reward):
                            await self.send(ws,{'type':'action_denied','reason':inv_capacity_reason(player['inventory'],reward)});continue
                        del self.camp_structures[ident]
                        if old['kind']=='bed':
                            for other_ws,other in self.clients.items():
                                if other.get('spawn_bed')==ident:
                                    other['spawn_bed']=None
                                    await self.send(other_ws,{'type':'spawn_bed_set','id':None})
                        await self.broadcast({'type':'camp_remove','id':ident})
                    elif typ=='storage':
                        old=self.storages.get(ident)
                        if old is None or math.hypot(old['x']-player['x'],old['z']-player['z'])>6:continue
                        if (old['kind']=='chest' and any(old['slots'])) or (old['kind']=='rack' and old['logs']):
                            await self.send(ws,{'type':'action_denied','reason':'Сначала освободи хранилище'});continue
                        reward={'id':old['kind'],'count':1}
                        if not inv_add(player['inventory'],reward):
                            await self.send(ws,{'type':'action_denied','reason':inv_capacity_reason(player['inventory'],reward)});continue
                        del self.storages[ident]
                        await self.broadcast({'type':'storage_remove','id':ident})
                    elif typ=='log':
                        old=self.logs.get(ident)
                        if old is None or math.hypot(old['x']-player['x'],old['z']-player['z'])>6:continue
                        if not inv_space_for(player['inventory'],'log'):
                            await self.send(ws,{'type':'action_denied','reason':inv_capacity_reason(player['inventory'],{'id':'log','count':1})});continue
                        inv_give_logs(player['inventory'],1);player['wood']+=1
                        del self.logs[ident]
                        await self.broadcast({'type':'log_remove','id':ident,'by':uid,'wood':player['wood']})
                    else:continue
                    player['last_build']=now
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                    self.save()
                elif kind=='hit':
                    if not player['axe_equipped']:continue
                    advance_hunger(player,now)
                    advance_stamina(player,now)
                    if not server_can_hit(player):
                        await self.send(ws,{'type':'vitals_state','vitals':vitals_view(player)})
                        await self.send(ws,{'type':'action_denied','reason':server_chop_warning(player)})
                        continue
                    tier=min(max(player.get('axe_tier',0),0),len(AXE_LEVELS)-1)
                    damage,speed=AXE_LEVELS[tier]
                    if now-player['last_hit']<.28/speed:continue
                    player['last_hit']=now
                    if await self.hit_tree(player,data.get('tree',''),now,damage=damage*chop_damage_multiplier(player)):
                        spend_hit_stamina(player)
                        player['last_stamina_sent']=now
                        await self.send(ws,{'type':'vitals_state','vitals':vitals_view(player)})
        except Exception as exc:print('Disconnected:',uid,type(exc).__name__)
        finally:
            self.clients.pop(ws,None);await self.broadcast({'type':'leave','id':uid})

async def main():
    ap=argparse.ArgumentParser();ap.add_argument('--host',default='0.0.0.0');ap.add_argument('--port',type=int,default=8765);ap.add_argument('--save',default='forest_world.json');ap.add_argument('--bot-token',default=os.getenv('FOREST_BOT_TOKEN',''));args=ap.parse_args()
    world=World(args.save,args.bot_token)
    # Persist the creation time and seed even before the first player modifies
    # the world. Server status then reports a stable world age after a restart.
    if not world.path.exists():
        world.save()
    async with serve(world.handler,args.host,args.port,max_size=MAX_MESSAGE,ping_interval=20):
        simulation=asyncio.create_task(world.bots.run())
        expiry_task=asyncio.create_task(world.box_expiration_loop())
        print(f'Forest Chopper multiplayer: ws://{args.host}:{args.port} (up to 32 players)')
        try:await asyncio.Future()
        finally:
            world.bots.running=False
            simulation.cancel();expiry_task.cancel()
            await asyncio.gather(simulation,expiry_task,return_exceptions=True)

if __name__=='__main__':
    try:asyncio.run(main())
    except KeyboardInterrupt:print('\nStopped')
