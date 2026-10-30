// Per-browser, local-only lifetime stats and small achievements.
// Not server-authoritative; only count events confirmed by the game client.
export const PROGRESS_KEY = 'forest-chopper:progress:v1';
export const ACHIEVEMENTS = [
  {id:'first-tree',title:'Первое дерево',metric:'trees',goal:1},
  {id:'five-trees',title:'Лесоруб · 5 деревьев',metric:'trees',goal:5},
  {id:'twenty-trees',title:'Опытный лесоруб · 20',metric:'trees',goal:20},
  {id:'hundred-trees',title:'Мастер леса · 100',metric:'trees',goal:100},
  {id:'first-log',title:'Начинающий строитель',metric:'logs',goal:1},
  {id:'ten-logs',title:'Плотник · 10 брёвен',metric:'logs',goal:10},
  {id:'walk-100',title:'Первые 100 метров',metric:'distance',goal:100},
  {id:'walk-1000',title:'Путешественник · 1 км',metric:'distance',goal:1000},
  {id:'explore-10',title:'Исследователь · 10 чанков',metric:'chunks',goal:10},
];
export const OBJECTIVES = [
  {id:'cut-3',title:'Срубите 3 дерева',metric:'trees',goal:3},
  {id:'build-5',title:'Поставьте 5 брёвен',metric:'logs',goal:5},
  {id:'walk-100',title:'Пройдите 100 метров',metric:'distance',goal:100},
  {id:'explore-4',title:'Откройте 4 новых чанка',metric:'chunks',goal:4},
];
const validCount = n => Number.isSafeInteger(n) && n >= 0 && n <= 10_000_000;

export function parseProgress(raw) {
  try {
    const data=typeof raw==='string' && raw.length<250_000 ? JSON.parse(raw) : null;
    if (!data || data.version!==1 || !validCount(data.trees) || !validCount(data.logs)
        || !Number.isFinite(data.distance) || data.distance<0 || data.distance>10_000_000
        || !Array.isArray(data.visited) || data.visited.length>5000
        || data.visited.some(key=>typeof key!=='string' || key.length>50
          || !/^\d+:-?\d+,-?\d+$/.test(key))) return null;
    const objective=data.objective;
    const savedObjective=objective && Number.isInteger(objective.index)
      && objective.index>=0 && objective.index<=OBJECTIVES.length
      && Number.isFinite(objective.baseline) && objective.baseline>=0
      && objective.baseline<=10_000_000
      && (objective.index===OBJECTIVES.length || objective.baseline <=
        (OBJECTIVES[objective.index].metric==='chunks' ? new Set(data.visited).size : data[OBJECTIVES[objective.index].metric])) ? objective : null;
    return {trees:data.trees,logs:data.logs,distance:data.distance,
      visited:[...new Set(data.visited)],objective:savedObjective};
  } catch {return null;}
}

export function createProgress({
  doc = document,
  storage = null,
  notify = () => {},
  start = {x:0,z:0},
  setTimer = (fn,delay) => setTimeout(fn,delay),
  clearTimer = id => clearTimeout(id),
} = {}) {
  if (!storage) {
    try {storage=window.localStorage;} catch { /* In-memory statistics still work. */ }
  }
  let restored=null;
  try {restored=parseProgress(storage?.getItem(PROGRESS_KEY));} catch { /* Fresh local stats. */ }
  const state={
    trees:restored?.trees??0, logs:restored?.logs??0, distance:restored?.distance??0,
  };
  const visited=new Set(restored?.visited??[]);
  const metricValue=metric=>metric==='chunks'?visited.size:state[metric];
  let objectiveIndex=restored?.objective?.index??0;
  let objectiveBaseline=restored?.objective?.baseline??metricValue(OBJECTIVES[objectiveIndex]?.metric??'trees');
  const unlocked=new Set(ACHIEVEMENTS.filter(a=>(a.metric==='chunks' ? visited.size : state[a.metric])>=a.goal).map(a=>a.id));
  let previous={x:start.x,z:start.z}, timer=null;

  const style=doc.createElement('style');
  style.textContent=`
.fc-progress-toggle{position:fixed;z-index:12;top:96px;right:16px;border-radius:9px;padding:9px 12px;font-size:12px}
.fc-progress-panel{position:fixed;z-index:17;top:137px;right:12px;width:min(315px,calc(100vw - 24px));max-height:calc(100dvh - 152px);overflow:auto;background:#10251ff4;color:white;border:1px solid #ffffff66;border-radius:12px;padding:13px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 10px 24px #0009}
.fc-progress-panel[hidden]{display:none}
.fc-progress-panel h2{font-size:15px;margin:0 0 6px}
.fc-progress-panel p{margin:0 0 10px;color:#c1dbc8}
.fc-progress-panel ul{margin:0;padding:0;list-style:none}
.fc-progress-panel li{padding:5px 0;border-top:1px solid #ffffff1f;opacity:.66}
.fc-progress-panel li[data-unlocked=true]{color:#b5f3c5;opacity:1}
.fc-objective{padding:9px 10px;margin:0 0 11px;border:1px solid #8ab89a55;border-radius:8px;background:#193c2a}
.fc-objective strong{display:block;color:#bcf4c9}
.fc-objective button{margin-top:7px;border-radius:6px;padding:4px 8px;font-size:12px}
@media(max-width:650px){.fc-progress-toggle{top:180px;right:12px;padding:8px 10px;font-size:11px}.fc-progress-panel{top:222px;max-height:calc(100dvh - 235px)}}
`;
  doc.head.append(style);
  const button=doc.createElement('button');
  button.className='fc-progress-toggle';
  button.type='button';button.textContent='🏅 Прогресс';
  button.setAttribute('aria-expanded','false');
  const panel=doc.createElement('section');
  panel.className='fc-progress-panel';panel.hidden=true;
  panel.setAttribute('aria-label','Локальные достижения');
  const heading=doc.createElement('h2');heading.textContent='🏅 Достижения';
  const summary=doc.createElement('p');
  const list=doc.createElement('ul');
  const objectiveBox=doc.createElement('div');objectiveBox.className='fc-objective';
  const objectiveTitle=doc.createElement('strong');
  const objectiveText=doc.createElement('span');
  const skipObjectiveButton=doc.createElement('button');
  skipObjectiveButton.type='button';skipObjectiveButton.textContent='Пропустить цель';
  objectiveBox.append(objectiveTitle,objectiveText,skipObjectiveButton);
  panel.append(heading,summary,objectiveBox,list);
  doc.body.append(button,panel);

  function render() {
    if (panel.hidden) return;
    summary.textContent=`Локально: 🌲 ${state.trees} · 🪵 ${state.logs} · 🚶 ${Math.floor(state.distance)} м · 🧭 ${visited.size} чанков`;
    const objective=OBJECTIVES[objectiveIndex];
    objectiveTitle.textContent=objective ? `Цель ${objectiveIndex+1}/${OBJECTIVES.length}: ${objective.title}` : 'Все мини-цели выполнены!';
    objectiveText.textContent=objective ? `Прогресс: ${Math.min(objective.goal,Math.max(0,Math.floor(metricValue(objective.metric)-objectiveBaseline)))}/${objective.goal}` : 'Можно продолжать исследовать лес.';
    skipObjectiveButton.hidden=!objective;
    list.replaceChildren(...ACHIEVEMENTS.map(a=>{
      const item=doc.createElement('li');
      item.dataset.unlocked=String(unlocked.has(a.id));
      item.textContent=`${unlocked.has(a.id)?'✓':'○'} ${a.title}`;
      return item;
    }));
  }
  function persist() {
    if (!storage) return;
    try {
      storage.setItem(PROGRESS_KEY,JSON.stringify({version:1,...state,visited:[...visited],
        objective:{index:objectiveIndex,baseline:objectiveBaseline}}));
    } catch { /* Disabled storage does not prevent play. */ }
  }
  function schedule() {
    if (timer !== null || !storage) return;
    timer=setTimer(()=>{timer=null;persist();},1200);
  }
  function unlockNew() {
    for(const a of ACHIEVEMENTS) {
      if(unlocked.has(a.id))continue;
      const value=a.metric==='chunks'?visited.size:state[a.metric];
      if(value>=a.goal){
        unlocked.add(a.id);
        notify(`Достижение: ${a.title}`,'success',`achievement-${a.id}`);
      }
    }
  }
  function advanceObjective() {
    const current=OBJECTIVES[objectiveIndex];
    if(!current || metricValue(current.metric)-objectiveBaseline<current.goal)return;
    notify(`Цель выполнена: ${current.title}`,'success',`objective-${current.id}`);
    objectiveIndex++;
    objectiveBaseline=metricValue(OBJECTIVES[objectiveIndex]?.metric??'trees');
    schedule();
  }
  function skipObjective() {
    if(objectiveIndex>=OBJECTIVES.length)return false;
    objectiveIndex++;
    objectiveBaseline=metricValue(OBJECTIVES[objectiveIndex]?.metric??'trees');
    schedule();render();return true;
  }
  skipObjectiveButton.onclick=skipObjective;
  function record(event) {
    if(event==='tree-fell')state.trees++;
    else if(event==='log-placed')state.logs++;
    else return false;
    unlockNew();advanceObjective();schedule();render();return true;
  }
  function resetPosition(x,z) {
    previous=Number.isFinite(x)&&Number.isFinite(z)?{x,z}:null;
  }
  function trackPosition(x,z,seed) {
    if(!Number.isFinite(x)||!Number.isFinite(z)||!Number.isInteger(seed))return;
    const key=`${seed}:${Math.floor(x/24)},${Math.floor(z/24)}`;
    if(visited.size<5000 && !visited.has(key)){visited.add(key);schedule();}
    if(previous) {
      const distance=Math.hypot(x-previous.x,z-previous.z);
      if(distance>0 && distance<=4){state.distance=Math.round((state.distance+distance)*100)/100;schedule();}
    }
    previous={x,z};unlockNew();advanceObjective();render();
  }
  function close(){panel.hidden=true;button.setAttribute('aria-expanded','false');}
  button.onclick=()=>{
    if(!panel.hidden){close();return;}
    doc.getElementById('network').style.display='none';
    doc.querySelector('.fc-settings-toggle')?.setAttribute('aria-expanded','false');
    doc.querySelector('.fc-settings')?.setAttribute('hidden','');
    panel.hidden=false;button.setAttribute('aria-expanded','true');render();
  };
  doc.addEventListener('click',e=>{
    if(e.target.closest?.('.fc-settings-toggle,#nettoggle'))close();
  });
  if(typeof window!=='undefined')window.addEventListener('pagehide',()=>{
    if(timer!==null){clearTimer(timer);timer=null;}
    persist();
  });
  return {record,trackPosition,resetPosition,close,skipObjective,
    get objective(){const current=OBJECTIVES[objectiveIndex];return current
      ? {index:objectiveIndex,title:current.title,goal:current.goal,
        progress:Math.min(current.goal,Math.max(0,Math.floor(metricValue(current.metric)-objectiveBaseline)))}
      : {index:objectiveIndex,done:true};},
    get stats(){return {...state,chunks:visited.size};},
    get unlocked(){return [...unlocked];}};
}
