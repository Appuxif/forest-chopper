// Startup-only state: no Three.js, scene objects or Web Workers.
import {parseOfflineSave,slotKey} from './offline-save.js';

export const MENU_SERVERS_KEY='forest-chopper:recent-servers:v1';
export const MENU_NAME_KEY='forest-chopper:player-name:v1';
export const MENU_FAVORITES_KEY='forest-chopper:favorite-servers:v1';
export const MENU_LAUNCH_KEY='forest-chopper:launch:v1';
export const MAX_SEED=999998;

export function parseSeed(raw){
  if(!/^(0|[1-9]\d*)$/.test(String(raw).trim()))return null;
  const value=Number(String(raw).trim());
  return Number.isSafeInteger(value)&&value<=MAX_SEED?value:null;
}
// Only parse URL input here. The menu applies it through its normal controls.
export function parseLaunchQuery(search=''){
  const params=new URLSearchParams(String(search).replace(/^\?/,''));
  const type=params.get('type');
  const performance=params.get('performance');
  const diag=params.get('diag');
  return {
    type:['continue','new','multiplayer'].includes(type)?type:null,
    seedProvided:params.has('seed'),
    seed:params.has('seed')?parseSeed(params.get('seed')):null,
    force:params.get('force')==='true',
    performance:['low','medium','high'].includes(performance)?performance:null,
    diag:diag==='true'?true:diag==='false'?false:null,
    name:params.has('name')?String(params.get('name')).trim().slice(0,22):null,
    server:params.has('server')?params.get('server'):null,
  };
}

export function readLocalWorld(storage,slot=1){
  try{return parseOfflineSave(storage?.getItem(slotKey(slot))??null);}
  catch{return null;}
}
export function listSavedSlots(storage){
  return Array.from({length:10},(_,index)=>{
    const slot=index+1;
    try {
      const raw=storage?.getItem(slotKey(slot))??null;
      const save=parseOfflineSave(raw);
      if(!save)return {slot,save:null,metadata:null};
      const data=JSON.parse(raw);
      return {slot,save,metadata:{createdAt:data.createdAt??null,savedAt:data.savedAt??null}};
    }catch{return {slot,save:null,metadata:null};}
  });
}
export function formatSavedWorld(save){
  if(!save)return '';
  return 'Seed '+save.seed+' · '+save.cuts+' деревьев · '+save.wood+' 🪵';
}
export function normalizeServerAddress(raw){
  let text=String(raw??'').trim();
  if(!text||text.length>250)return null;
  if(/^[a-z][a-z0-9+.-]*:\/\//i.test(text)&&!/^(ws|wss):\/\//i.test(text))return null;
  if(!/^(ws|wss):\/\//i.test(text))text=(typeof location!=='undefined'&&location.protocol==='https:'?'wss://':'ws://')+text;
  try{
    const u=new URL(text);
    if(!['ws:','wss:'].includes(u.protocol)||!u.hostname||u.username||u.password||u.hash)return null;
    return u.href;
  }catch{return null;}
}
export function serverStatusAddress(address){
  const u=new URL(address);
  u.pathname='/status';u.search='';u.hash='';
  return u.href;
}
export function parseServerStatus(message){
  if(!message||message.type!=='server_status'||message.protocol_version!==1
    ||typeof message.name!=='string'||message.name.length>80
    ||!Number.isInteger(message.online)||message.online<0||message.online>10000
    ||!Number.isInteger(message.max_players)||message.max_players<1||message.max_players>10000
    ||!Number.isInteger(message.world_seed)||message.world_seed<0||message.world_seed>MAX_SEED
    ||typeof message.world_created_at!=='number'||!Number.isFinite(message.world_created_at)
    ||message.world_created_at<=0||message.world_created_at>Date.now()/1000+600
    ||typeof message.day_phase!=='number'||message.day_phase<0||message.day_phase>=1
    )return null;
  return {
    name:message.name,online:message.online,maxPlayers:message.max_players,
    seed:message.world_seed,createdAt:message.world_created_at,
    dayPhase:message.day_phase,
  };
}
export function formatWorldAge(seconds){
  const value=Math.max(0,Math.floor(seconds));
  const days=Math.floor(value/86400);
  const hours=Math.floor((value%86400)/3600);
  const minutes=Math.floor((value%3600)/60);
  return days?days+' д '+hours+' ч':hours?hours+' ч '+minutes+' мин':minutes+' мин';
}
export function recentServers(storage){
  try{
    const values=JSON.parse(storage.getItem(MENU_SERVERS_KEY)||'[]');
    return Array.isArray(values)?values.filter(value=>typeof value==='string'&&normalizeServerAddress(value)===value).slice(0,6):[];
  }catch{return [];}
}
export function rememberServer(storage,address){
  const value=normalizeServerAddress(address);
  if(!value)return [];
  const items=[value,...recentServers(storage).filter(item=>item!==value)].slice(0,6);
  try{storage?.setItem(MENU_SERVERS_KEY,JSON.stringify(items));}catch{}
  return items;
}

export function favoriteServers(storage){
  try{
    const data=JSON.parse(storage?.getItem(MENU_FAVORITES_KEY)||'[]');
    return Array.isArray(data)?data.filter(value=>typeof value==='string'
      &&normalizeServerAddress(value)===value).slice(0,12):[];
  }catch{return [];}
}
export function toggleFavoriteServer(storage,address){
  const normalized=normalizeServerAddress(address);
  if(!normalized)return favoriteServers(storage);
  const existing=favoriteServers(storage);
  const next=existing.includes(normalized)?existing.filter(item=>item!==normalized):
    [normalized,...existing].slice(0,12);
  try{storage?.setItem(MENU_FAVORITES_KEY,JSON.stringify(next));}catch{}
  return next;
}
