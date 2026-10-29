"""Persistent manual demo client (the bot disappears when this process exits)."""
import asyncio
import json
import shlex
import sys
from bot_gateway import gateway

async def main():
    name=' '.join(sys.argv[1:]) or 'CLI Lumberjack'
    info=await gateway.register('cli',name)
    print('Bot registered:',info)
    print('Commands: observe, status, follow ID, stop, chop TREE_ID, harvest WOOD, goto X Z, say TEXT, quit')
    try:
        while True:
            cmd=await asyncio.to_thread(input,'forest-bot> ')
            parts=shlex.split(cmd)
            if not parts:continue
            op,*args=parts
            if op in ('exit','quit'):break
            try:
                if op=='status':result=await gateway.command('cli','brief')
                elif op=='observe':result=await gateway.command('cli','observe')
                elif op=='follow':result=await gateway.command('cli','startFollowing',player_id=int(args[0]))
                elif op=='stop':result=await gateway.command('cli','cancelTask')
                elif op=='chop':result=await gateway.command('cli','startTask',task='chopTree',params={'treeId':args[0]})
                elif op=='harvest':result=await gateway.command('cli','startTask',task='harvest',params={'wood':int(args[0])})
                elif op=='goto':result=await gateway.command('cli','startTask',task='navigate',params={'x':float(args[0]),'z':float(args[1])})
                elif op=='say':result=await gateway.command('cli','say',text=' '.join(args))
                else:result={'error':'Unknown command'}
                print(json.dumps(result,ensure_ascii=False,indent=2))
            except (ValueError,IndexError,ConnectionError) as e:print('Error:',e)
    finally:
        await gateway.close()

if __name__=='__main__':
    try:asyncio.run(main())
    except (KeyboardInterrupt,EOFError):pass
