"""Small reusable WebSocket client for headless Forest Chopper bots.

One game-server connection per agent session; no browser, rendering or LLM.
"""
import asyncio
import json
import os
from websockets.asyncio.client import connect

GAME_URL=os.getenv('FOREST_GAME_URL','ws://127.0.0.1:8765/bots')
BOT_TOKEN=os.getenv('FOREST_BOT_TOKEN','')


class BotConnection:
    def __init__(self, url=GAME_URL, token=BOT_TOKEN):
        self.url=url
        self.token=token
        self.socket=None
        self.lock=asyncio.Lock()
        self.seq=0
        self.bot_id=None

    async def call(self, op, **params):
        async with self.lock:
            if self.socket is None or self.socket.state.name!='OPEN':
                raise ConnectionError('Bot disconnected; register again')
            self.seq+=1
            await self.socket.send(json.dumps({'op':op,'request_id':self.seq,**params}))
            raw=await asyncio.wait_for(self.socket.recv(),timeout=15)
            response=json.loads(raw)
            if response.get('request_id')!=self.seq:
                raise RuntimeError('Unexpected server response')
            if not response.get('ok'):
                raise ValueError(response.get('error','Bot command failed'))
            return response['result']

    async def open(self,name):
        self.socket=await connect(self.url,max_size=2**20,open_timeout=10)
        try:
            data=await self.call('register',name=name,token=self.token)
            self.bot_id=data['id']
            return data
        except BaseException:
            await self.close()
            raise

    async def close(self):
        if self.socket:
            await self.socket.close()
            self.socket=None


class Gateway:
    def __init__(self):
        self.sessions={}
        self.lock=asyncio.Lock()

    async def register(self,session_id,name='AI Lumberjack'):
        if not isinstance(session_id,str) or not 1<=len(session_id)<=128:
            raise ValueError('Provide a stable session_id (1..128 chars)')
        async with self.lock:
            conn=self.sessions.get(session_id)
            if conn and conn.socket and conn.socket.state.name=='OPEN':
                return {'bot_id':conn.bot_id,'session_id':session_id,'reused':True}
            if conn:await conn.close()
            conn=BotConnection()
            result=await conn.open(name)
            self.sessions[session_id]=conn
            return {'bot_id':result['id'],'name':result['name'],'session_id':session_id,'reused':False}

    def get(self,session_id):
        conn=self.sessions.get(session_id)
        if not conn:raise ValueError('Unknown session_id: call register_agent first')
        return conn

    async def command(self,session_id,op,**params):
        return await self.get(session_id).call(op,**params)

    async def unregister(self,session_id):
        conn=self.sessions.pop(session_id,None)
        if not conn:return {'removed':False}
        await conn.close()
        return {'removed':True,'session_id':session_id}

    async def close(self):
        for conn in list(self.sessions.values()):await conn.close()
        self.sessions.clear()


gateway=Gateway()
