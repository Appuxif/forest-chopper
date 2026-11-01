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
from server_bots import BotManager, can_stand
from terrain_height import height_at, base_height
from ponds import pond_depth_at, pond_height_before_lakes

MAX_MESSAGE = 2048
# Initial 3 kg axe leaves capacity for three 25 kg logs, regardless of bag slots.
DEFAULT_WOOD_CAPACITY = 3
BOX_TTL_SECONDS=3600
MUSHROOM_SPECIES=('fly_agaric','boletus','death_cap','milkcap')
FLOWER_SPECIES=('daisy','buttercup','pink_wildflower','blue_wildflower')
DECOR_ITEM_IDS=tuple('mushroom:'+name for name in MUSHROOM_SPECIES)+tuple('flower:'+name for name in FLOWER_SPECIES)
ITEM_LIMITS={"log":5,"branch":10,"stone":10,"bench":1,"axe":1,
             **{name:10 for name in DECOR_ITEM_IDS}}
MAX_CARRY_WEIGHT=100
ITEM_WEIGHT={"log":25,"branch":0.5,"stone":2,"bench":15,"axe":3,
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
HUNGER_INTERVAL_SECONDS=300
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
}
def vitals_view(player):
    return {'health':player['health'],'hunger':player['hunger'],
            'stamina':round(player.get('stamina',MAX_VITALS),3),
            'staminaLocked':player.get('stamina_sprint_locked',False),
            'hungerProgress':player['hunger_progress']}

def advance_hunger(player,now):
    delta=max(0,min(now-player['last_hunger_at'],3600))
    player['last_hunger_at']=now
    if player['hunger']==0:return False
    progress=player['hunger_progress']+delta
    steps=int(progress//HUNGER_INTERVAL_SECONDS)
    if steps==0:
        player['hunger_progress']=progress
        return False
    player['hunger']=max(0,player['hunger']-steps)
    player['hunger_progress']=progress%HUNGER_INTERVAL_SECONDS if player['hunger'] else 0
    return True

def advance_stamina(player,now):
    last=player.get('last_stamina_at',now)
    elapsed=max(0,min(now-last,1))
    player['last_stamina_at']=now
    before=player.get('stamina',float(MAX_VITALS))
    if player.get('sprinting',False) and not player.get('stamina_sprint_locked',False):
        value=max(0,before-STAMINA_SPRINT_DRAIN*elapsed)
        if value<=0:
            player['stamina_sprint_locked']=True
            player['sprinting']=False
    else:
        value=min(MAX_VITALS,before+STAMINA_REGEN*elapsed)
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
    if item['id'] in ('axe','bench'):return None in inv
    limit=ITEM_LIMITS[item['id']]
    return sum(limit-it['count'] if it and it['id']==item['id'] else limit if it is None else 0 for it in inv)>=item['count']

def inv_add(inv,item):
    if not inv_can_add(inv,item):return False
    kind=item['id'];left=1 if kind=='axe' else item['count']
    if kind not in ('axe','bench'):
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
    else:return None
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
DAY_CYCLE_SECONDS = 8 * 60
DAY_SYNC_SECONDS = 10

class World:
    def day_phase(self, now=None):
        current=time.time() if now is None else now
        return ((current-self.day_epoch)/DAY_CYCLE_SECONDS)%1

    def __init__(self,path,bot_token=""):
        self.path=Path(path);self.clients={};self.next_id=1;self.seed=random.randrange(1,999999)
        self.felled=set();self.damage={};self.logs={};self.next_log=1;self.furniture={};self.next_furniture=1;self.boxes={};self.next_box=1;self.resource_cooldowns={};self.community_cuts=0;self.chat=[];self.chat_seq=0
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
                logs={int(k):v for k,v in data.get('logs',{}).items()}
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
                boxes_raw=data.get('boxes',{})
                if not isinstance(boxes_raw,dict) or len(boxes_raw)>500:raise ValueError('Invalid boxes')
                boxes={}
                for raw_id,box in boxes_raw.items():
                    ident=int(raw_id)
                    if not 0<ident<2147483647 or not isinstance(box,dict) or not valid_item(box.get('item')):raise ValueError('Invalid box')
                    if any(type(box.get(key)) not in (int,float) or not math.isfinite(box[key]) or abs(box[key])>240000
                           for key in ('x','z')):raise ValueError('Invalid box position')
                    if type(box.get('expires_at')) not in (int,float) or not math.isfinite(box['expires_at']):raise ValueError('Invalid expiry')
                    if box['expires_at']>time.time():boxes[ident]=box
                self.boxes=boxes;self.next_box=max((int(k) for k in boxes_raw),default=0)+1
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
                self.seed=seed;self.felled=felled;self.damage=damage;self.logs=logs;self.furniture=furniture;self.next_furniture=max(furniture,default=0)+1;self.community_cuts=community_cuts;self.resource_cooldowns=cooldowns
                self.next_log=max(logs,default=0)+1
                print('Loaded world:',self.path)
            except (ValueError,KeyError,TypeError) as exc:print('Invalid save, starting fresh:',exc)
    def save(self):
        data={'seed':self.seed,'terrain_version':3,'felled':list(self.felled),'damage':self.damage,'logs':self.logs,'furniture':self.furniture,'boxes':self.boxes,'resource_cooldowns':self.resource_cooldowns,'community_cuts':self.community_cuts,'day_epoch':self.day_epoch,'world_created_at':self.world_created_at}
        tmp=self.path.with_suffix('.tmp');tmp.write_text(json.dumps(data));os.replace(tmp,self.path)
    async def prune_boxes(self,now=None):
        now=time.time() if now is None else now
        expired=[i for i,b in self.boxes.items() if b['expires_at']<=now]
        for ident in expired:del self.boxes[ident]
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
                if hunger_changed or (stamina_changed and
                    current-player.get('last_stamina_sent',0)>=.6):
                    player['last_stamina_sent']=current
                    await self.send(ws,{'type':'vitals_state','vitals':vitals_view(player)})

    async def send(self,ws,data):
        try:await ws.send(json.dumps(data,separators=(',',':')))
        except Exception:pass
    async def broadcast(self,data,except_ws=None):
        if self.clients:await asyncio.gather(*(self.send(ws,data) for ws in list(self.clients) if ws!=except_ws))
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
            self.felled.add(key);self.damage.pop(key,None)
            reward=(inv_give_logs(player['inventory'],5) if 'inventory' in player
                    else 5)
            player['wood']+=reward;player['cuts']+=1;self.community_cuts+=1
            await self.broadcast({'type':'tree_fell','tree':key,'by':player['id'],
                                  'wood':player['wood'],'cuts':player['cuts'],'community_cuts':self.community_cuts})
        else:
            self.damage[key]=hp
            await self.broadcast({'type':'tree_hit','tree':key,'hp':hp})
        if 'inventory' in player and hp<=0:
            for ws,client in self.clients.items():
                if client is player:await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']});break
        self.save()
        return True

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
        player={'id':uid,'name':f'Игрок {uid}','x':0,'z':0,'y':height_at(self.seed,0,0),'yaw':0,'jumping':False,'wood':0,'cuts':0,'last_hit':0,'last_pos':time.monotonic(),'last_build':0,'last_chat':0,'last_map_ping':0,'last_emote':0,'axe_equipped':True,'axe_tier':0,'wood_capacity':DEFAULT_WOOD_CAPACITY,'inventory':new_inventory(),'selected':0,'quick_refs':[0,1,2,3],'quick_ids':['axe',None,None,None],'bag_tier':0,'health':MAX_VITALS,'hunger':MAX_VITALS,'hunger_progress':0.0,'last_hunger_at':time.monotonic(),'stamina':float(MAX_VITALS),'last_stamina_at':time.monotonic(),'stamina_sprint_locked':False,'sprinting':False,'last_stamina_sent':0,'last_jump':-10000,'jump_authorized_until':0}
        self.clients[ws]=player
        await self.prune_boxes()
        await self.send(ws,{'type':'welcome','id':uid,'seed':self.seed,'day_phase':self.day_phase(),'felled':list(self.felled),'damage':self.damage,'logs':[{'id':k,**v} for k,v in self.logs.items()],'furniture':[{'id':k,**v} for k,v in self.furniture.items()],'players':[{k:v for k,v in p.items() if k in ('id','name','x','z','y','yaw','jumping','axe_equipped')} for w,p in self.clients.items() if w!=ws]+[self.bots.player_data(b) for b in self.bots.players()],'wood':0,'cuts':0,'inventory':inventory_view(player),'vitals':vitals_view(player),'boxes':[{'id':k,**v} for k,v in self.boxes.items()],'resources':self.resource_view(player)['resources'],'community_cuts':self.community_cuts,'chat':self.chat[-40:]})
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
                elif kind=='drop_item':
                    slot=data.get('slot')
                    if type(slot) is not int or not 0<=slot<len(player['inventory']) or len(self.boxes)>=500:continue
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
                    if not box or box['expires_at']<=time.time() or math.hypot(player['x']-box['x'],player['z']-box['z'])>2.8:continue
                    if not inv_add(player['inventory'],box['item']):
                        await self.send(ws,{'type':'action_denied','reason':inv_capacity_reason(player['inventory'],box['item'])});continue
                    if box['item']['id']=='log':player['wood']+=box['item']['count']
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
                elif kind=='consume_food':
                    slot=data.get('slot')
                    if type(slot) is not int or not 0<=slot<len(player['inventory']):continue
                    item=player['inventory'][slot]
                    if not item or item['id'] not in FOOD_EFFECTS or item.get('count',0)<1:continue
                    advance_hunger(player,now)
                    player['inventory'][slot]['count']-=1
                    if player['inventory'][slot]['count']==0:player['inventory'][slot]=None
                    apply_food(player,item['id'])
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                    await self.send(ws,{'type':'vitals_state','vitals':vitals_view(player)})
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
                    player.update(x=x,z=z,y=y,yaw=yaw,jumping=jumping,last_pos=now)
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
                    if not math.isfinite(x) or not math.isfinite(z) or orientation not in ((0,1) if item['id']=='log' else (0,1,2,3)) or math.hypot(x-player['x'],z-player['z'])>6:continue
                    if abs(x)>240000 or abs(z)>240000 or abs(x*2-round(x*2))>1e-4 or abs(z*2-round(z*2))>1e-4:continue
                    if pond_depth_at(self.seed,x,z)>.2:continue
                    if item['id']=='log':
                        p={'x':x,'z':z,'orientation':orientation}
                        def overlaps(a,b):return abs(a['x']-b['x'])<(3.2 if a['orientation']==b['orientation']==0 else 1.65) and abs(a['z']-b['z'])<(3.2 if a['orientation']==b['orientation']==1 else 1.65)
                        p['level']=max((v['level']+1 for v in self.logs.values() if overlaps(p,v)),default=0)
                        if p['level']>=16:continue
                        p['y']=height_at(self.seed,x,z)+.29+p['level']*.29*1.8
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
                    if await self.hit_tree(player,data.get('tree',''),now,damage=damage):
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
