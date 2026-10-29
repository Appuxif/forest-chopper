"""Standalone multi-session MCP gateway for Forest Chopper headless bots.

Run: uv run --with 'mcp>=2,<3' --with 'websockets>=13,<17' python bot_mcp.py
Or install dependencies and simply: python bot_mcp.py
"""
import os
from mcp.server.mcpserver import MCPServer
from bot_gateway import gateway

mcp=MCPServer('Forest Chopper Bots',instructions='Call register_agent(session_id,name) once. Then use the SAME session_id on every tool call. Prefer get_brief to reduce context. One agent owns one bot. Experimental trusted-MCP prototype: session_id is NOT an authentication token.')


@mcp.tool()
async def register_agent(session_id:str,name:str='AI Lumberjack')->dict:
    """Create/reuse your own bot and bind it to this LLM session ID."""
    return await gateway.register(session_id,name)


@mcp.tool()
async def observe(session_id:str,radius:int=30,limit:int=12)->dict:
    """Find nearby trees and players; use only when selecting a new target."""
    return await gateway.command(session_id,'observe',radius=radius,limit=limit)


@mcp.tool()
async def get_brief(session_id:str,after_chat_id:int=0)->dict:
    """Cheap status: position, current task, resources and new chat messages."""
    return await gateway.command(session_id,'brief',after_chat_id=after_chat_id)


@mcp.tool()
async def get_task(session_id:str,task_id:int=0)->dict|None:
    """Get active or latest finished task; optionally specify task_id."""
    return await gateway.command(session_id,'getTask',**({'id':task_id} if task_id else {}))


@mcp.tool()
async def start_task(session_id:str,task_type:str,params:dict|None=None)->dict:
    """Non-blocking: navigate {x,z}, chopTree {treeId}, followPlayer {playerId}, move {direction,milliseconds,sprint}, harvest {wood}."""
    return await gateway.command(session_id,'startTask',task=task_type,params=params or {})


@mcp.tool()
async def navigate_to(session_id:str,x:float,z:float,stop_distance:float=1.7)->dict:
    """Start background walking/running to coordinates. Returns task ID immediately."""
    return await start_task(session_id,'navigate',{'x':x,'z':z,'stopDistance':stop_distance})


@mcp.tool()
async def chop_tree(session_id:str,tree_id:str)->dict:
    """Approach tree and chop it autonomously; returns task ID immediately."""
    return await start_task(session_id,'chopTree',{'treeId':tree_id})


@mcp.tool()
async def harvest(session_id:str,wood:int=50)->dict:
    """Autonomously collect wood until total inventory reaches target amount."""
    return await start_task(session_id,'harvest',{'wood':wood})


@mcp.tool()
async def start_following(session_id:str,player_id:int)->dict:
    """Follow a player indefinitely until explicitly stopped. Runs on game server."""
    return await gateway.command(session_id,'startFollowing',player_id=player_id)


@mcp.tool()
async def stop_following(session_id:str)->dict:
    """Stop following; does not cancel unrelated tasks."""
    return await gateway.command(session_id,'stopFollowing')


@mcp.tool()
async def stop(session_id:str)->dict:
    """Cancel active bot task and stand still."""
    return await gateway.command(session_id,'cancelTask')


@mcp.tool()
async def say(session_id:str,text:str)->dict:
    """Send a message to in-game multiplayer chat as this bot."""
    return await gateway.command(session_id,'say',text=text)


@mcp.tool()
async def remove_agent(session_id:str)->dict:
    """Disconnect and remove your bot from the game."""
    return await gateway.unregister(session_id)


if __name__=='__main__':
    # stdio is easiest to connect locally; HTTP remains opt-in for a trusted setup.
    transport=os.getenv('FOREST_MCP_TRANSPORT','stdio')
    mcp.run(transport=transport)
