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
from websockets.exceptions import ConnectionClosed
from server_bots import BotManager, can_stand

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
    def __init__(self,path,bot_token=""):
        self.path=Path(path);self.clients={};self.next_id=1;self.seed=random.randrange(1,999999)
        self.felled=set();self.damage={};self.logs={};self.next_log=1;self.chat=[];self.chat_seq=0
        self.bots=BotManager(self);self.bot_token=bot_token
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

    async def hit_tree(self,player,uid_key,now):
        key=str(uid_key)
        info=tree_info(key,self.seed)
        if not info or key in self.felled or math.hypot(player['x']-info[0],player['z']-info[1])>6.5:
            return False
        hp=self.damage.get(key,info[2])-1
        if hp<=0:
            self.felled.add(key);self.damage.pop(key,None)
            player['wood']+=5;player['cuts']+=1
            await self.broadcast({'type':'tree_fell','tree':key,'by':player['id'],
                                  'wood':player['wood'],'cuts':player['cuts']})
        else:
            self.damage[key]=hp
            await self.broadcast({'type':'tree_hit','tree':key,'hp':hp})
        self.save()
        return True

    async def handler(self,ws):
        if ws.request.path.split('?',1)[0]=='/bots':
            await self.bot_handler(ws);return
        if len(self.clients)+len(self.bots.bots)>=32:await ws.close(1013,'Server full');return
        uid=self.next_id;self.next_id+=1
        player={'id':uid,'name':f'Игрок {uid}','x':0,'z':0,'y':0,'yaw':0,'jumping':False,'wood':0,'cuts':0,'last_hit':0,'last_pos':time.monotonic(),'last_build':0,'last_chat':0}
        self.clients[ws]=player
        await self.send(ws,{'type':'welcome','id':uid,'seed':self.seed,'felled':list(self.felled),'damage':self.damage,'logs':[{'id':k,**v} for k,v in self.logs.items()],'players':[{k:v for k,v in p.items() if k in ('id','name','x','z','y','yaw','jumping')} for w,p in self.clients.items() if w!=ws]+[self.bots.player_data(b) for b in self.bots.players()],'wood':0,'cuts':0,'chat':self.chat[-40:]})
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
                elif kind=='hit':
                    if now-player['last_hit']<.28:continue
                    player['last_hit']=now
                    await self.hit_tree(player,data.get('tree',''),now)
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
    ap=argparse.ArgumentParser();ap.add_argument('--host',default='0.0.0.0');ap.add_argument('--port',type=int,default=8765);ap.add_argument('--save',default='forest_world.json');ap.add_argument('--bot-token',default=os.getenv('FOREST_BOT_TOKEN',''));args=ap.parse_args()
    world=World(args.save,args.bot_token)
    async with serve(world.handler,args.host,args.port,max_size=MAX_MESSAGE,ping_interval=20):
        simulation=asyncio.create_task(world.bots.run())
        print(f'Forest Chopper multiplayer: ws://{args.host}:{args.port} (up to 32 players)')
        try:await asyncio.Future()
        finally:
            world.bots.running=False
            simulation.cancel()
            await asyncio.gather(simulation,return_exceptions=True)

if __name__=='__main__':
    try:asyncio.run(main())
    except KeyboardInterrupt:print('\nStopped')
