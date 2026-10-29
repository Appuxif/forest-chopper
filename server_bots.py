"""Tiny headless bot simulation for Forest Chopper. No rendering or LLM dependencies.

MVP: bots walk on the ground, collide with trunks and low logs, and execute
one task at a time. Human players still use the existing client-side physics.
"""
import asyncio
import math
import time

CHUNK = 24
BOT_SPEED = 4.6
TREE_RADIUS = .75
BOT_RADIUS = .31


def trees_near(world, x, z, radius=30):
    from forest_server import tree_info
    size = int(math.ceil(radius / CHUNK)) + 1
    cx, cz = math.floor(x / CHUNK), math.floor(z / CHUNK)
    for ix in range(cx-size, cx+size+1):
        for iz in range(cz-size, cz+size+1):
            for i in range(8):
                key = f'{ix},{iz}:{i}'
                if key in world.felled:
                    continue
                info = tree_info(key, world.seed)
                if info and math.hypot(info[0]-x, info[1]-z) <= radius:
                    yield key, info


def can_stand(world, x, z, feet=0):
    # Exact same trunk clearance and ground-level log footprint as physics.js.
    for _, (tx, tz, _) in trees_near(world, x, z, 1.5):
        if math.hypot(x-tx, z-tz) < TREE_RADIUS:
            return False
    for log in world.logs.values():
        top = log['y'] + .29
        bottom = log['y'] - .29
        if not (feet < top-.045 and feet+1.7 > bottom+.045):
            continue
        along = x-log['x'] if log['orientation'] == 0 else z-log['z']
        across = z-log['z'] if log['orientation'] == 0 else x-log['x']
        if math.hypot(max(0, abs(along)-1.8), across) < .29 + BOT_RADIUS:
            return False
    return True


class BotManager:
    def __init__(self, world):
        self.world = world
        self.bots = {}
        self.task_ids = 0
        self.running = True

    def player_data(self, bot):
        return {k: bot[k] for k in ('id','name','x','z','y','yaw','jumping')}

    def players(self):
        return list(self.bots.values())

    async def create(self, name):
        if len(self.bots)+len(self.world.clients) >= 32:
            raise ValueError('Server full (32 players/bots max)')
        uid = self.world.next_id
        self.world.next_id += 1
        bot = {'id':uid, 'name':str(name or f'Bot {uid}')[:22], 'x':0.,'y':0.,'z':0.,
               'yaw':0.,'jumping':False,'wood':0,'cuts':0,'task':None,'last_task':None,
               'last_hit':0.,'last_move':0.,'blocked_for':0.,'last_pos':(0.,0.),'last_yaw':0.}
        self.bots[uid] = bot
        await self.world.broadcast({'type':'join','player':self.player_data(bot)})
        return bot

    async def remove(self, uid):
        if self.bots.pop(uid, None):
            await self.world.broadcast({'type':'leave','id':uid})

    def task_view(self, bot):
        task = bot['task']
        return {k:v for k,v in task.items() if k not in ('next_hit', 'stalled', 'approach', 'started_at_mono', 'skipped') } if task else None

    def brief(self, bot, after_chat_id=0):
        return {'id':bot['id'], 'name':bot['name'], 'position':[round(bot['x'],2),round(bot['z'],2)],
                'wood':bot['wood'],'cuts':bot['cuts'],'task':self.task_view(bot),
                'last_task':bot['last_task'],
                'chat':[{'id':m['id'],'from':m['from'],'name':m['name'],'text':m['text']}
                        for m in self.world.chat if m['id']>after_chat_id][:20],
                'chat_id':self.world.chat_seq}

    def observe(self, bot, radius=30, limit=12):
        radius=max(1,min(100,float(radius)))
        limit=max(1,min(40,int(limit)))
        def desc(key,x,z,**extra):
            return {'id':key,'x':round(x,2),'z':round(z,2),
                    'distance':round(math.hypot(x-bot['x'],z-bot['z']),2),**extra}
        trees=sorted((desc(key,x,z,hp=self.world.damage.get(key,hp))
            for key,(x,z,hp) in trees_near(self.world,bot['x'],bot['z'],radius)),key=lambda a:a['distance'])[:limit]
        people=[*self.world.clients.values(), *self.bots.values()]
        players=sorted((desc(p['id'],p['x'],p['z'],name=p['name'])
            for p in people if p['id']!=bot['id'] and math.hypot(p['x']-bot['x'],p['z']-bot['z'])<=radius),
            key=lambda a:a['distance'])
        return {'self':self.brief(bot),'trees':trees,'players':players}

    def start(self, bot, kind, params):
        if bot['task'] and bot['task']['status']=='running':
            return {'status':'busy','task':self.task_view(bot)}
        if kind not in ('navigate','followPlayer','chopTree','harvest','move'):
            raise ValueError('Unsupported task')
        if not isinstance(params,dict):raise ValueError('params must be an object')
        if kind=='navigate':
            for k in ('x','z'):
                if k not in params or not math.isfinite(float(params[k])):
                    raise ValueError('Valid x,z required')
            stop=float(params.get('stopDistance',1.7))
            timeout=float(params.get('timeout',12000))
            if not (math.isfinite(stop) and .1<=stop<=10 and math.isfinite(timeout) and 100<=timeout<=30000):
                raise ValueError('Invalid stopDistance or timeout')
        if kind=='move':
            if params.get('direction') not in ('forward','backward','left','right'):
                raise ValueError('direction must be forward, backward, left or right')
            duration=float(params.get('milliseconds',500))
            if not math.isfinite(duration) or not 0<=duration<=15000:
                raise ValueError('milliseconds must be 0..15000')
        if kind=='harvest':
            target=int(params.get('wood',5))
            if not 1<=target<=100000:raise ValueError('wood must be 1..100000')
        if kind=='followPlayer':
            if 'playerId' not in params or int(params['playerId'])<1:
                raise ValueError('Valid playerId required')
            if int(params['playerId'])==bot['id']:
                raise ValueError('Cannot follow yourself')
        if kind=='chopTree' and not isinstance(params.get('treeId'),str):
            raise ValueError('treeId required')
        self.task_ids+=1
        task={'id':self.task_ids,'type':kind,'status':'running','phase':'starting',
              'params':params.copy(),'started_at':time.time(),'started_at_mono':time.monotonic()}
        bot['task']=task
        bot['blocked_for']=0.
        return self.task_view(bot)

    def stop(self,bot):
        if bot['task']:
            self.finish(bot,'cancelled')
        return self.brief(bot)

    def finish(self, bot, outcome):
        task=bot['task']
        if task:
            task['status']='cancelled' if outcome=='cancelled' else 'completed'
            task['phase']=outcome
            task['finished_at']=time.time()
            bot['last_task']=self.task_view(bot)
            bot['task']=None

    def approach(self, bot, target_x, target_z, dt, stop_distance):
        dx,dz=target_x-bot['x'],target_z-bot['z']
        distance=math.hypot(dx,dz)
        if distance<=stop_distance:
            bot['blocked_for']=0.
            return True
        # Try forward first, then simple steering around obstacles.
        angle=math.atan2(dx,dz)
        step=min(BOT_SPEED*dt,max(.0,distance-stop_distance))
        for offset in (0, .4, -.4, .8, -.8, 1.3, -1.3, 2.0, -2.0):
            heading=angle+offset
            vx=math.sin(heading)*step;vz=math.cos(heading)*step
            nx=bot['x']+vx;nz=bot['z']+vz
            if can_stand(self.world,nx,nz):
                bot['x'],bot['z']=nx,nz
                bot['yaw']=-heading
                bot['blocked_for']=0.
                return False
            if can_stand(self.world,nx,bot['z']):
                bot['x']=nx;bot['yaw']=-heading;bot['blocked_for']=0.
                return False
            if can_stand(self.world,bot['x'],nz):
                bot['z']=nz;bot['yaw']=-heading;bot['blocked_for']=0.
                return False
        bot['blocked_for']+=dt
        return False

    def target(self, bot, task):
        kind=task['type'];params=task['params']
        if kind=='navigate':return float(params['x']),float(params['z']),float(params.get('stopDistance',1.7))
        if kind=='followPlayer':
            uid=int(params['playerId'])
            target=next((p for p in [*self.world.clients.values(),*self.bots.values()] if p['id']==uid),None)
            if target is None:
                self.finish(bot,'player_not_found');return None
            return target['x'],target['z'],2.8
        if kind in ('chopTree','harvest'):
            from forest_server import tree_info
            if kind=='harvest' and not task.get('treeId'):
                trees=sorted((entry for entry in trees_near(self.world,bot['x'],bot['z'],55)
                    if entry[0] not in task.get('skipped',[])),
                    key=lambda item:math.hypot(item[1][0]-bot['x'],item[1][1]-bot['z']))
                if not trees:
                    self.finish(bot,'no_trees');return None
                task['treeId']=trees[0][0]
            key=task.get('treeId',params.get('treeId'))
            tree=tree_info(key,self.world.seed)
            if not tree or key in self.world.felled:
                if kind=='harvest':task.pop('treeId',None);return None
                self.finish(bot,'tree_not_found');return None
            x,z,_=tree
            dx,dz=bot['x']-x,bot['z']-z
            dist=math.hypot(dx,dz)
            # Approach 1.85m from trunk, as the browser debug agent does.
            scale=1.85 / (dist or 1)
            return x+dx*scale,z+dz*scale,.20
        return None

    async def tick(self, dt):
        now=time.monotonic()
        for bot in list(self.bots.values()):
            task=bot['task']
            if task:
                kind=task['type'];params=task['params']
                if kind=='move':
                    elapsed=now-task['started_at_mono']
                    duration=float(params.get('milliseconds',500))/1000
                    if elapsed>=duration:
                        self.finish(bot,'duration_complete')
                    else:
                        direction=params['direction']
                        offset={'forward':0,'backward':math.pi,'left':-math.pi/2,'right':math.pi/2}[direction]
                        heading=-bot['yaw']+offset
                        speed=BOT_SPEED if params.get('sprint',False) else 2.5
                        step=min(speed*dt,speed*(duration-elapsed))
                        nx=bot['x']+math.sin(heading)*step;nz=bot['z']+math.cos(heading)*step
                        if can_stand(self.world,nx,nz):
                            bot['x'],bot['z']=nx,nz
                            task['phase']='moving'
                        else:self.finish(bot,'blocked')
                elif kind=='harvest' and bot['wood']>=int(params.get('wood',5)):
                    self.finish(bot,'target_reached')
                elif kind=='navigate' and now-task['started_at_mono']>float(params.get('timeout',12000))/1000:
                    self.finish(bot,'timeout')
                else:
                    goal=self.target(bot,task)
                    if goal:
                        arrived=self.approach(bot,goal[0],goal[1],dt,goal[2])
                        task['phase']='near_player' if arrived and kind=='followPlayer' else 'moving'
                        if bot['blocked_for']>4:
                            if kind=='harvest':
                                task.setdefault('skipped',[]).append(task.pop('treeId',None))
                                bot['blocked_for']=0
                            elif kind=='followPlayer':
                                task['phase']='blocked';bot['blocked_for']=0
                            else:self.finish(bot,'blocked')
                        elif arrived:
                            if kind=='navigate':self.finish(bot,'arrived')
                            elif kind in ('chopTree','harvest'):
                                key=task.get('treeId',params.get('treeId'))
                                task['phase']='chopping'
                                if now>=task.get('next_hit',0):
                                    tree=next((a for a in trees_near(self.world,bot['x'],bot['z'],5)
                                        if a[0]==key),None)
                                    if tree:
                                        x,z,_=tree[1]
                                        bot['yaw']=math.atan2(-(x-bot['x']),-(z-bot['z']))
                                        await self.world.hit_tree(bot,key,now)
                                    task['next_hit']=now+1.35
                                    if key in self.world.felled:
                                        if kind=='harvest':task.pop('treeId',None)
                                        else:self.finish(bot,'felled')
            if now-bot['last_move']>=.1 and (bot['last_pos']!=(bot['x'],bot['z']) or bot['last_yaw']!=bot['yaw']):
                bot['last_move']=now
                bot['last_pos']=(bot['x'],bot['z']);bot['last_yaw']=bot['yaw']
                await self.world.broadcast({'type':'move',**self.player_data(bot)})

    async def run(self):
        last=time.monotonic()
        while self.running:
            now=time.monotonic();dt=min(.10,now-last);last=now
            await self.tick(dt)
            await asyncio.sleep(.05)
