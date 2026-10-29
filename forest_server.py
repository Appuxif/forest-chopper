#!/usr/bin/env python3
"""Forest Chopper multiplayer server. pip install websockets>=13"""
import argparse
import asyncio
import json
import math
import os
import random
import time
from pathlib import Path
from websockets.asyncio.server import serve

MAX_MESSAGE = 2048

def r(x,z,n,seed):
    v=math.sin(x*127.1+z*311.7+n*78.233+seed)*43758.5453
    return v-math.floor(v)

def tree_info(key,seed):
    try:
        chunk,index=key.split(':');cx,cz=map(int,chunk.split(','));i=int(index)
        if not (-10000<=cx<=10000 and -10000<=cz<=10000 and 0<=i<8):return None
        x=cx*24+r(cx,cz,i*3,seed)*24
        z=cz*24+r(cx,cz,i*3+1,seed)*24
        if math.hypot(x,z)<8:return None
        hp=7+int(r(x,z,8,seed)*5)
        return x,z,hp
    except (ValueError,TypeError):return None

class World:
    def __init__(self,path):
        self.path=Path(path);self.clients={};self.next_id=1;self.seed=random.randrange(1,999999)
        self.felled=set();self.damage={};self.logs={};self.next_log=1
        if self.path.exists():
            try:
                data=json.loads(self.path.read_text());self.seed=int(data['seed']);self.felled=set(data.get('felled',[]));self.damage={str(k):int(v) for k,v in data.get('damage',{}).items()};self.logs={int(k):v for k,v in data.get('logs',{}).items()};self.next_log=max(self.logs,default=0)+1
                print('Loaded world:',self.path)
            except (ValueError,KeyError,TypeError) as exc:print('Invalid save, starting fresh:',exc)
    def save(self):
        data={'seed':self.seed,'felled':list(self.felled),'damage':self.damage,'logs':self.logs}
        tmp=self.path.with_suffix('.tmp');tmp.write_text(json.dumps(data));os.replace(tmp,self.path)
    async def send(self,ws,data):
        try:await ws.send(json.dumps(data,separators=(',',':')))
        except Exception:pass
    async def broadcast(self,data,except_ws=None):
        if self.clients:await asyncio.gather(*(self.send(ws,data) for ws in list(self.clients) if ws!=except_ws))
    async def handler(self,ws):
        if len(self.clients)>=32:await ws.close(1013,'Server full');return
        uid=self.next_id;self.next_id+=1
        player={'id':uid,'name':f'Игрок {uid}','x':0,'z':0,'y':0,'yaw':0,'jumping':False,'wood':0,'cuts':0,'last_hit':0,'last_pos':time.monotonic(),'last_build':0}
        self.clients[ws]=player
        await self.send(ws,{'type':'welcome','id':uid,'seed':self.seed,'felled':list(self.felled),'damage':self.damage,'logs':[{'id':k,**v} for k,v in self.logs.items()],'players':[{k:v for k,v in p.items() if k in ('id','name','x','z','y','yaw','jumping')} for w,p in self.clients.items() if w!=ws],'wood':0,'cuts':0})
        try:
            async for raw in ws:
                if len(raw)>MAX_MESSAGE:continue
                try:data=json.loads(raw)
                except (ValueError,TypeError):continue
                if not isinstance(data,dict):continue
                kind=data.get('type');now=time.monotonic()
                if kind=='hello':
                    player['name']=str(data.get('name','Игрок'))[:22].strip() or f'Игрок {uid}'
                    await self.broadcast({'type':'join','player':{k:player[k] for k in ('id','name','x','z','y','yaw','jumping')}},ws)
                elif kind=='move':
                    try:x=float(data['x']);z=float(data['z']);yaw=float(data['yaw']);y=float(data.get('y',0));jumping=bool(data.get('jumping',False))
                    except (ValueError,KeyError,TypeError):continue
                    if not all(map(math.isfinite,(x,z,yaw,y))) or y<0 or y>12 or abs(x)>240000 or abs(z)>240000:continue
                    dt=max(.05,now-player['last_pos']);distance=math.hypot(x-player['x'],z-player['z'])
                    if distance>max(4,dt*11):continue
                    player.update(x=x,z=z,y=y,yaw=yaw,jumping=jumping,last_pos=now)
                    await self.broadcast({'type':'move','id':uid,'x':x,'z':z,'y':y,'yaw':yaw,'jumping':jumping},ws)
                elif kind=='hit':
                    if now-player['last_hit']<.28:continue
                    player['last_hit']=now
                    key=str(data.get('tree',''));info=tree_info(key,self.seed)
                    if not info or key in self.felled or math.hypot(player['x']-info[0],player['z']-info[1])>6.5:continue
                    hp=self.damage.get(key,info[2])-1
                    if hp<=0:
                        self.felled.add(key);self.damage.pop(key,None);player['wood']+=5;player['cuts']+=1
                        await self.broadcast({'type':'tree_fell','tree':key,'by':uid,'wood':player['wood'],'cuts':player['cuts']})
                    else:
                        self.damage[key]=hp;await self.broadcast({'type':'tree_hit','tree':key,'hp':hp})
                    self.save()
                elif kind=='place':
                    if now-player['last_build']<.12 or player['wood']<1:continue
                    player['last_build']=now
                    try:x=float(data['x']);z=float(data['z']);orientation=int(data['orientation'])
                    except (ValueError,TypeError,KeyError):continue
                    if not math.isfinite(x) or not math.isfinite(z) or orientation not in (0,1) or math.hypot(x-player['x'],z-player['z'])>6:continue
                    if abs(x*2-round(x*2))>1e-4 or abs(z*2-round(z*2))>1e-4:continue
                    def overlaps(a,b):return abs(a['x']-b['x'])<(3.2 if a['orientation']==b['orientation']==0 else 1.65) and abs(a['z']-b['z'])<(3.2 if a['orientation']==b['orientation']==1 else 1.65)
                    p={'x':x,'z':z,'orientation':orientation};level=max((v['level']+1 for v in self.logs.values() if overlaps(p,v)),default=0)
                    if level>=16:continue
                    p['level']=level;p['y']=.29+level*.29*1.8
                    lid=self.next_log;self.next_log+=1;self.logs[lid]=p;player['wood']-=1
                    await self.broadcast({'type':'log_add','log':{'id':lid,**p},'by':uid,'wood':player['wood']});self.save()
                elif kind=='remove':
                    if now-player['last_build']<.12:continue
                    player['last_build']=now
                    try:lid=int(data['id'])
                    except (ValueError,KeyError,TypeError):continue
                    p=self.logs.get(lid)
                    if not p or math.hypot(p['x']-player['x'],p['z']-player['z'])>6:continue
                    del self.logs[lid];player['wood']+=1
                    await self.broadcast({'type':'log_remove','id':lid,'by':uid,'wood':player['wood']});self.save()
        except Exception as exc:print('Disconnected:',uid,type(exc).__name__)
        finally:
            self.clients.pop(ws,None);await self.broadcast({'type':'leave','id':uid})

async def main():
    ap=argparse.ArgumentParser();ap.add_argument('--host',default='0.0.0.0');ap.add_argument('--port',type=int,default=8765);ap.add_argument('--save',default='forest_world.json');args=ap.parse_args()
    world=World(args.save)
    async with serve(world.handler,args.host,args.port,max_size=MAX_MESSAGE,ping_interval=20):
        print(f'Forest Chopper multiplayer: ws://{args.host}:{args.port} (up to 32 players)')
        await asyncio.Future()

if __name__=='__main__':
    try:asyncio.run(main())
    except KeyboardInterrupt:print('\nStopped')
