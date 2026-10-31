#!/usr/bin/env python3
"""Forest Chopper multiplayer server. pip install websockets>=13"""
import argparse
import asyncio
import json
import math
import os
import random
import time
from functools import lru_cache
from pathlib import Path
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed
from server_bots import BotManager, can_stand

MAX_MESSAGE = 2048
# Twelve initial bag slots; the axe occupies one. Future bag upgrades increase this.
DEFAULT_WOOD_CAPACITY = (12-1)*5
BOX_TTL_SECONDS=3600
ITEM_LIMITS={"log":5,"branch":10,"stone":10,"bench":1,"axe":1}
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
        if not tree_can_spawn(cx,cz,i,seed):return None
        hp=7+int(r(x,z,8,seed)*5)
        return x,z,hp
    except (ValueError,TypeError):return None

def new_inventory():
    return [{'id':'axe','tier':0}]+[None]*11

def inv_logs(inv):
    return sum(item['count'] for item in inv if item and item['id']=='log')

def inv_space_for(inv,kind,count=1):
    if kind=='bench':
        return any(item is None for item in inv)
    return sum((5-item['count'] if item and item['id']=='log' else 5 if item is None else 0) for item in inv)>=count

def inv_give_logs(inv,amount):
    left=amount
    for item in inv:
        if item and item['id']=='log' and left:
            n=min(left,5-item['count']);item['count']+=n;left-=n
    for i,item in enumerate(inv):
        if item is None and left:
            n=min(left,5);inv[i]={'id':'log','count':n};left-=n
    return amount-left

def inv_take_logs(inv,amount):
    if inv_logs(inv)<amount:return False
    for i in reversed(range(len(inv))):
        item=inv[i]
        if item and item['id']=='log' and amount:
            n=min(amount,item['count']);item['count']-=n;amount-=n
            if item['count']==0:inv[i]=None
    return True

def inv_add_bench(inv):
    try:i=inv.index(None)
    except ValueError:return False
    inv[i]={'id':'bench'}
    return True

def valid_item(item):
    if not isinstance(item,dict) or item.get('id') not in ITEM_LIMITS:return False
    if item['id']=='axe':return type(item.get('tier')) is int and 0<=item['tier']<len(AXE_LEVELS)
    return type(item.get('count')) is int and 1<=item['count']<=ITEM_LIMITS[item['id']]

def inv_count(inv,kind):
    return sum((1 if kind=='axe' else item['count']) for item in inv if item and item['id']==kind)

def inv_can_add(inv,item):
    if not valid_item(item):return False
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

def resources_update(player,now):
    if now-player['last_resources']<3:return None
    player['last_resources']=now
    x,z=player['x'],player['z'];resources=player['resources']
    for ident,item in list(resources.items()):
        if math.hypot(item['x']-x,item['z']-z)>10:del resources[ident]
    while len(resources)<10:
        angle=random.random()*math.tau;distance=3+random.random()*5.4
        player['resource_seq']+=1;ident=player['resource_seq']
        resources[ident]={'id':ident,'kind':random.choice(('branch','stone')),
                          'x':round(x+math.cos(angle)*distance,2),
                          'z':round(z+math.sin(angle)*distance,2)}
    return {'type':'resources_state','resources':list(resources.values())}

def inventory_view(player):
    return {'version':1,'bagTier':player.get('bag_tier',0),
            'selectedQuick':player.get('selected',0),
            'slots':player['inventory'],'dropped':None}

class World:
    def __init__(self,path,bot_token=""):
        self.path=Path(path);self.clients={};self.next_id=1;self.seed=random.randrange(1,999999)
        self.felled=set();self.damage={};self.logs={};self.next_log=1;self.furniture={};self.next_furniture=1;self.boxes={};self.next_box=1;self.community_cuts=0;self.chat=[];self.chat_seq=0
        self.bots=BotManager(self);self.bot_token=bot_token
        if self.path.exists():
            try:
                data=json.loads(self.path.read_text())
                # Parse everything before committing anything; malformed saves must not
                # silently create a mixed fresh/partially restored world.
                seed=int(data['seed'])
                felled=set(data.get('felled',[]))
                damage={str(k):int(v) for k,v in data.get('damage',{}).items()}
                logs={int(k):v for k,v in data.get('logs',{}).items()}
                raw_furniture=data.get('furniture',{})
                if not isinstance(raw_furniture,dict):raise ValueError('Invalid furniture save')
                furniture={int(k):v for k,v in raw_furniture.items()}
                if len(furniture)>200 or any(not 1<=k<=2147483647 for k in furniture) or any(
                    not isinstance(v,dict) or v.get('kind')!='bench' or
                    not all(type(v.get(axis)) in (int,float) and math.isfinite(v[axis]) and
                            abs(v[axis])<=240000 for axis in ('x','z')) or
                    type(v.get('orientation')) is not int or v['orientation'] not in (0,1)
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
                community_cuts=data.get('community_cuts',0)
                if type(community_cuts) is not int or not 0<=community_cuts<=1_000_000_000:
                    raise ValueError('Invalid community progress')
                self.seed=seed;self.felled=felled;self.damage=damage;self.logs=logs;self.furniture=furniture;self.next_furniture=max(furniture,default=0)+1;self.community_cuts=community_cuts
                self.next_log=max(logs,default=0)+1
                print('Loaded world:',self.path)
            except (ValueError,KeyError,TypeError) as exc:print('Invalid save, starting fresh:',exc)
    def save(self):
        data={'seed':self.seed,'felled':list(self.felled),'damage':self.damage,'logs':self.logs,'furniture':self.furniture,'boxes':self.boxes,'community_cuts':self.community_cuts}
        tmp=self.path.with_suffix('.tmp');tmp.write_text(json.dumps(data));os.replace(tmp,self.path)
    async def prune_boxes(self,now=None):
        now=time.time() if now is None else now
        expired=[i for i,b in self.boxes.items() if b['expires_at']<=now]
        for ident in expired:del self.boxes[ident]
        if expired:
            self.save()
            for ident in expired:await self.broadcast({'type':'box_remove','id':ident})
        return expired

    async def box_expiration_loop(self):
        while True:
            await asyncio.sleep(15)
            await self.prune_boxes()

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

    async def handler(self,ws):
        if ws.request.path.split('?',1)[0]=='/bots':
            await self.bot_handler(ws);return
        if len(self.clients)+len(self.bots.bots)>=32:await ws.close(1013,'Server full');return
        uid=self.next_id;self.next_id+=1
        player={'id':uid,'name':f'Игрок {uid}','x':0,'z':0,'y':0,'yaw':0,'jumping':False,'wood':0,'cuts':0,'last_hit':0,'last_pos':time.monotonic(),'last_build':0,'last_chat':0,'last_map_ping':0,'last_emote':0,'axe_equipped':True,'axe_tier':0,'wood_capacity':DEFAULT_WOOD_CAPACITY,'inventory':new_inventory(),'selected':0,'bag_tier':0,'resources':{},'last_resources':-10000,'resource_seq':0,'resources_enabled':False}
        self.clients[ws]=player
        await self.prune_boxes()
        resources_update(player,time.monotonic())
        await self.send(ws,{'type':'welcome','id':uid,'seed':self.seed,'felled':list(self.felled),'damage':self.damage,'logs':[{'id':k,**v} for k,v in self.logs.items()],'furniture':[{'id':k,**v} for k,v in self.furniture.items()],'players':[{k:v for k,v in p.items() if k in ('id','name','x','z','y','yaw','jumping','axe_equipped')} for w,p in self.clients.items() if w!=ws]+[self.bots.player_data(b) for b in self.bots.players()],'wood':0,'cuts':0,'inventory':inventory_view(player),'boxes':[{'id':k,**v} for k,v in self.boxes.items()],'resources':list(player['resources'].values()),'community_cuts':self.community_cuts,'chat':self.chat[-40:]})
        try:
            async for raw in ws:
                if len(raw)>MAX_MESSAGE:continue
                try:data=json.loads(raw)
                except (ValueError,TypeError):continue
                if not isinstance(data,dict):continue
                kind=data.get('type');now=time.monotonic()
                if kind=='collect_resource':
                    ident=data.get('id')
                    if type(ident) is not int:continue
                    resource=player['resources'].get(ident)
                    if not resource or math.hypot(player['x']-resource['x'],player['z']-resource['z'])>2.5:continue
                    if not inv_add(player['inventory'],{'id':resource['kind'],'count':1}):
                        await self.send(ws,{'type':'action_denied','reason':'Сумка заполнена'});continue
                    del player['resources'][ident]
                    await self.send(ws,{'type':'resources_state','resources':list(player['resources'].values())})
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
                    player['axe_equipped']=bool(player['inventory'][player['selected']] and player['inventory'][player['selected']]['id']=='axe')
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
                        await self.send(ws,{'type':'action_denied','reason':'Сумка заполнена'});continue
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
                    player['axe_equipped']=bool(player['inventory'][player['selected']] and player['inventory'][player['selected']]['id']=='axe')
                    await self.broadcast({'type':'equipment','by':uid,'axe_equipped':player['axe_equipped']})
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                elif kind=='craft_axe':
                    inv=player['inventory']
                    if inv_count(inv,'branch')<3 or inv_count(inv,'stone')<2:
                        await self.send(ws,{'type':'action_denied','reason':'Нужно 3 ветки и 2 камня'});continue
                    snapshot=[x.copy() if x else None for x in inv]
                    inv_take(inv,'branch',3);inv_take(inv,'stone',2)
                    if not inv_add(inv,{'id':'axe','tier':0}):
                        player['inventory']=snapshot
                        await self.send(ws,{'type':'action_denied','reason':'Нет свободного слота для топора'});continue
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                elif kind=='hello':
                    player['resources_enabled']=data.get('resources') is True
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
                elif kind=='move':
                    try:x=float(data['x']);z=float(data['z']);yaw=float(data['yaw']);y=float(data.get('y',0));jumping=bool(data.get('jumping',False))
                    except (ValueError,KeyError,TypeError):continue
                    if not all(map(math.isfinite,(x,z,yaw,y))) or y<0 or y>12 or abs(x)>240000 or abs(z)>240000:continue
                    dt=max(.05,now-player['last_pos']);distance=math.hypot(x-player['x'],z-player['z'])
                    if distance>max(4,dt*11) or not can_stand(self,x,z,y):continue
                    player.update(x=x,z=z,y=y,yaw=yaw,jumping=jumping,last_pos=now)
                    await self.broadcast({'type':'move','id':uid,'x':x,'z':z,'y':y,'yaw':yaw,'jumping':jumping},ws)
                    resources=resources_update(player,now)
                    if resources and player['resources_enabled']:await self.send(ws,resources)
                elif kind=='equip':
                    if data.get('item') not in ('axe',None):continue
                    player['axe_equipped']=player['inventory'][player['selected']] is not None and player['inventory'][player['selected']]['id']=='axe'
                    await self.broadcast({'type':'equipment','by':uid,'axe_equipped':player['axe_equipped']})
                elif kind=='select_slot':
                    slot=data.get('slot')
                    if type(slot) is not int or not 0<=slot<4:continue
                    player['selected']=slot
                    player['axe_equipped']=player['inventory'][slot] is not None and player['inventory'][slot]['id']=='axe'
                    await self.broadcast({'type':'equipment','by':uid,'axe_equipped':player['axe_equipped']})
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                elif kind=='move_slot':
                    a,b=data.get('from'),data.get('to')
                    if type(a) is not int or type(b) is not int or not(0<=a<len(player['inventory']) and 0<=b<len(player['inventory'])):continue
                    player['inventory'][a],player['inventory'][b]=player['inventory'][b],player['inventory'][a]
                    player['axe_equipped']=player['inventory'][player['selected']] is not None and player['inventory'][player['selected']]['id']=='axe'
                    await self.broadcast({'type':'equipment','by':uid,'axe_equipped':player['axe_equipped']})
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                elif kind=='craft_item':
                    if data.get('recipe')!='bench' or player['wood']<3 or not inv_space_for(player['inventory'],'bench'):
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
                    slot=player['selected']
                    item=player['inventory'][slot]
                    if item is None or item['id'] not in ('log','bench'):continue
                    try:x=float(data['x']);z=float(data['z']);orientation=int(data['orientation'])
                    except (ValueError,KeyError,TypeError,OverflowError):continue
                    if not math.isfinite(x) or not math.isfinite(z) or orientation not in (0,1) or math.hypot(x-player['x'],z-player['z'])>6:continue
                    if abs(x)>240000 or abs(z)>240000 or abs(x*2-round(x*2))>1e-4 or abs(z*2-round(z*2))>1e-4:continue
                    if item['id']=='log':
                        p={'x':x,'z':z,'orientation':orientation}
                        def overlaps(a,b):return abs(a['x']-b['x'])<(3.2 if a['orientation']==b['orientation']==0 else 1.65) and abs(a['z']-b['z'])<(3.2 if a['orientation']==b['orientation']==1 else 1.65)
                        p['level']=max((v['level']+1 for v in self.logs.values() if overlaps(p,v)),default=0)
                        if p['level']>=16:continue
                        p['y']=.29+p['level']*.29*1.8
                        if not inv_take_logs(player['inventory'],1):continue
                        player['wood']-=1
                        lid=self.next_log;self.next_log+=1;self.logs[lid]=p
                        await self.broadcast({'type':'log_add','log':{'id':lid,**p},'by':uid,'wood':player['wood']})
                    else:
                        if len(self.furniture)>=200 or not can_stand(self,x,z,0):continue
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
                            await self.send(ws,{'type':'action_denied','reason':'Сумка заполнена'});continue
                        del self.furniture[ident]
                        await self.broadcast({'type':'furniture_remove','id':ident,'by':uid,'wood':player['wood']})
                    elif typ=='log':
                        old=self.logs.get(ident)
                        if old is None or math.hypot(old['x']-player['x'],old['z']-player['z'])>6:continue
                        if not inv_space_for(player['inventory'],'log'):
                            await self.send(ws,{'type':'action_denied','reason':'Сумка заполнена'});continue
                        inv_give_logs(player['inventory'],1);player['wood']+=1
                        del self.logs[ident]
                        await self.broadcast({'type':'log_remove','id':ident,'by':uid,'wood':player['wood']})
                    else:continue
                    player['last_build']=now
                    await self.send(ws,{'type':'inventory_state','inventory':inventory_view(player),'wood':player['wood']})
                    self.save()
                elif kind=='hit':
                    if not player['axe_equipped']:continue
                    tier=min(max(player.get('axe_tier',0),0),len(AXE_LEVELS)-1)
                    damage,speed=AXE_LEVELS[tier]
                    if now-player['last_hit']<.28/speed:continue
                    player['last_hit']=now
                    await self.hit_tree(player,data.get('tree',''),now,damage=damage)
        except Exception as exc:print('Disconnected:',uid,type(exc).__name__)
        finally:
            self.clients.pop(ws,None);await self.broadcast({'type':'leave','id':uid})

async def main():
    ap=argparse.ArgumentParser();ap.add_argument('--host',default='0.0.0.0');ap.add_argument('--port',type=int,default=8765);ap.add_argument('--save',default='forest_world.json');ap.add_argument('--bot-token',default=os.getenv('FOREST_BOT_TOKEN',''));args=ap.parse_args()
    world=World(args.save,args.bot_token)
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
