// UI for tuning both generator parameter sets, per graphics quality.
// Editing only updates local profiles; applying reloads and regenerates the
// shared meshes exactly once, keeping instancing/world IDs intact.
import {
  TREE_FIELDS,TREE_GROUPS,TREE_QUALITIES,defaultTreeModel,loadTreeProfiles,
  saveTreeProfiles,sanitizeTreeModel,sanitizeTreeProfiles,
} from './tree-model-config.js';

const esc=value=>String(value).replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
}[c]));
const names={low:'Low',balanced:'Balanced',high:'High'};
function fieldMarkup(species,key,field){
  const id='fc-tree-'+species+'-'+key;
  const label=esc(field.name),hint=field.hint?'<small>'+esc(field.hint)+'</small>':'';
  let control='';
  const data=' data-tree-param="'+esc(key)+'" data-tree-species="'+species+'"';
  if(field.type==='boolean')control='<input id="'+id+'" type="checkbox"'+data+'>';
  else if(field.type==='color')control='<input id="'+id+'" type="color"'+data+'>';
  else if(field.type==='array')control='<input id="'+id+'" type="text" spellcheck="false" placeholder="7, 6, 5 ... (или пусто)"'+data+'>';
  else if(field.type==='select'){
    control='<select id="'+id+'"'+data+'>'+field.choices.map(v=>
      '<option value="'+esc(v)+'">'+esc(names[v]??v)+'</option>').join('')+'</select>';
  }else{
    const common='min="'+field.min+'" max="'+field.max+'" step="'+field.step+'"';
    control='<span class="fc-tree-numeric">'
      +'<input id="'+id+'" type="range" '+common+data+' aria-label="'+label+' — ползунок">'
      +'<input type="number" '+common+data+' aria-label="'+label+' — число">'
      +'</span>';
  }
  return '<div class="fc-tree-field"><label for="'+id+'">'+label+'</label>'+control+hint+'</div>';
}
function panelMarkup(species){
  const fields=TREE_FIELDS[species],groups=TREE_GROUPS[species];
  const groupsHtml=Object.entries(groups).map(([group,title],i)=>{
    const controls=Object.entries(fields).filter(([,f])=>f.group===group)
      .map(([key,f])=>fieldMarkup(species,key,f)).join('');
    if(!controls)return '';
    return '<details class="fc-tree-section" '+(i===0||group==='foliage'?'open':'')+'>'
      +'<summary>'+esc(title)+'</summary><div class="fc-tree-fields">'+controls+'</div></details>';
  }).join('');
  return '<div class="fc-tree-species" data-tree-species-panel="'+species+'"'
    +(species==='birch'?' hidden':'')+'>'+groupsHtml+'</div>';
}
export function treeModelEditorMarkup(){
  return '<h2>🌲 Редактор моделей деревьев</h2>'
    +'<small>Независимые модели для Low / Balanced / High. Настраиваются параметры генератора; применяются без перезагрузки игры.</small>'
    +'<div class="fc-tree-toolbar"><label>Профиль графики<select id="fc-tree-profile">'
    +TREE_QUALITIES.map(q=>'<option value="'+q+'">'+names[q]+'</option>').join('')
    +'</select></label><label>Скопировать из<select id="fc-tree-copy-from">'
    +TREE_QUALITIES.map(q=>'<option value="'+q+'">'+names[q]+'</option>').join('')
    +'</select></label></div>'
    +'<p id="fc-tree-active-stats" class="fc-tree-active-stats"></p>'
    +'<div class="fc-tree-actions">'
    +'<button type="button" data-tree-action="spruce" aria-pressed="true">🌲 Ель</button>'
    +'<button type="button" data-tree-action="birch" aria-pressed="false">🌳 Берёза</button>'
    +'<button type="button" data-tree-action="copy">Копировать профиль</button>'
    +'</div>'
    +panelMarkup('spruce')+panelMarkup('birch')
    +'<div class="fc-tree-actions">'
    +'<button type="button" data-tree-action="reset">Сбросить выбранный профиль</button>'
    +'<button type="button" data-tree-action="export">Экспорт JSON</button>'
    +'<button type="button" data-tree-action="import">Импорт JSON</button>'
    +'</div>'
    +'<textarea id="fc-tree-json" rows="5" spellcheck="false" placeholder="Экспорт или импорт всех профилей моделей (JSON)"></textarea>'
    +'<p id="fc-tree-status" role="status" aria-live="polite"></p>'
    +'<button type="button" class="fc-tree-apply" data-tree-action="apply">Применить профиль без перезагрузки</button>'
    +'<small>При применении меняется геометрия деревьев без перезагрузки игры. Точки деревьев, HP и сохранённый мир не изменяются. FPS лучше сравнивать при одинаковом ракурсе.</small>';
}
export function mountTreeModelEditor(root,{
  storage,getQuality=()=> 'balanced',applyQuality=()=>{},reload=()=>{},activeStats=null,
}={}){
  if(!root?.addEventListener)return {selectProfile(){},resetAll(){}};
  let profiles=loadTreeProfiles(storage),quality=getQuality(),species='spruce';
  const loadedQuality=quality;
  if(!TREE_QUALITIES.includes(quality))quality='balanced';
  const lookup=selector=>root.querySelector(selector);
  const status=(message,error=false)=>{
    const node=lookup('#fc-tree-status');
    if(node){node.textContent=message;node.dataset.error=String(error);}
  };
  function render(){
    const metrics=lookup('#fc-tree-active-stats');
    if(metrics){
      const spruce=activeStats?.spruce,birch=activeStats?.birch;
      metrics.textContent=spruce&&birch
        ? 'Последняя загрузка ('+names[loadedQuality]+'): ель — '
          +spruce.woodTriangles+' треуг. дерева / '+spruce.needleTriangles
          +' треуг. хвои ('+spruce.needleCount+' карточек); берёза — '
          +birch.triangles+' треуг. всего ('+birch.cards+' карточек).'
        : 'Геометрия пересоздаётся при применении профиля.';
    }
    lookup('#fc-tree-profile').value=quality;
    for(const item of root.querySelectorAll('[data-tree-species-panel]'))
      item.hidden=item.dataset.treeSpeciesPanel!==species;
    for(const b of root.querySelectorAll('[data-tree-action="spruce"],[data-tree-action="birch"]'))
      b.setAttribute('aria-pressed',String(b.dataset.treeAction===species));
    for(const input of root.querySelectorAll('[data-tree-param]')){
      const key=input.dataset.treeParam,speciesName=input.dataset.treeSpecies;
      const value=profiles[quality][speciesName][key],field=TREE_FIELDS[speciesName][key];
      if(field.type==='boolean')input.checked=value;
      else if(field.type==='array')input.value=value.join(', ');
      else input.value=String(value);
    }
  }
  function persist(message){
    const saved=saveTreeProfiles(storage,profiles);
    status(saved?message:'Не удалось сохранить профиль (localStorage недоступен).',!saved);
  }
  function edit(input){
    const key=input.dataset.treeParam,kind=input.dataset.treeSpecies;
    const field=TREE_FIELDS[kind]?.[key];
    if(!field)return;
    let value;
    if(field.type==='boolean')value=input.checked;
    else if(field.type==='array'){
      const raw=input.value.trim();
      const parsed=raw===''?[]:raw.split(',').map(x=>Number(x.trim()));
      if(parsed.length>24||parsed.some(x=>!Number.isInteger(x)||x<0||x>10)){
        status('Ветвей по ярусам: до 24 целых чисел 0–10, через запятую.',true);return;
      }
      value=parsed;
    }else if(field.type==='number'){
      // Do not save incomplete manual edits. Let the input regain focus.
      if(input.value.trim()==='')return;
      value=Number(input.value);
      if(!Number.isFinite(value)||value<field.min||value>field.max){
        status(field.name+': допустимо '+field.min+'…'+field.max,true);return;
      }
    }else value=input.value;
    const next=sanitizeTreeModel(kind,{...profiles[quality][kind],[key]:value});
    profiles[quality][kind]=next;
    persist('Изменения сохранены для '+names[quality]+'. Нажмите «Применить», чтобы увидеть их в лесу.');
    render();
  }
  root.addEventListener('input',event=>{
    const input=event.target;
    if(input.dataset?.treeParam && (input.type==='range'||input.type==='color'))
      edit(input);
  });
  root.addEventListener('change',event=>{
    const input=event.target;
    if(input.id==='fc-tree-profile'){
      quality=TREE_QUALITIES.includes(input.value)?input.value:'balanced';
      render();status('Редактируется профиль '+names[quality]+'.');return;
    }
    if(input.dataset?.treeParam && input.type!=='range'&&input.type!=='color')
      edit(input);
  });
  root.addEventListener('click',event=>{
    const action=event.target?.dataset?.treeAction;
    if(!action)return;
    if(action==='spruce'||action==='birch'){species=action;render();return;}
    if(action==='copy'){
      const from=lookup('#fc-tree-copy-from').value;
      if(!TREE_QUALITIES.includes(from)||from===quality){status('Выберите другой исходный профиль.',true);return;}
      profiles[quality]=structuredClone(profiles[from]);
      persist('Параметры обеих пород скопированы из '+names[from]+' в '+names[quality]+'.');
      render();
    }else if(action==='reset'){
      profiles[quality]={spruce:defaultTreeModel('spruce'),birch:defaultTreeModel('birch')};
      persist('Профиль '+names[quality]+' сброшен к параметрам генераторов.');
      render();
    }else if(action==='export'){
      lookup('#fc-tree-json').value=JSON.stringify({version:1,profiles},null,2);
      status('JSON всех профилей подготовлен. Можно скопировать его для сохранения.');
    }else if(action==='import'){
      try{
        const data=JSON.parse(lookup('#fc-tree-json').value);
        if(data?.version!==1||!data.profiles || !TREE_QUALITIES.every(q=>
          data.profiles[q]?.spruce&&data.profiles[q]?.birch))
          throw Error('Ожидается JSON экспорта всех трёх профилей (version: 1).');
        profiles=sanitizeTreeProfiles(data.profiles);
        persist('Импортированы все три профиля. Примените для проверки.');
        render();
      }catch(err){status('Ошибка импорта: '+err.message,true);}
    }else if(action==='apply'){
      if(!saveTreeProfiles(storage,profiles)){
        status('Не удалось сохранить настройки. Перезагрузка отменена.',true);return;
      }
      applyQuality(quality);
      reload();
    }
  });
  render();
  return {
    selectProfile(q){if(TREE_QUALITIES.includes(q)){quality=q;render();}},
    resetAll(){profiles=loadTreeProfiles({getItem:()=>null});saveTreeProfiles(storage,profiles);render();},
    getProfiles(){return structuredClone(profiles);},
  };
}
