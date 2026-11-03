import {PROFILE_LABELS} from './render-profiler.js';

// Copy exactly the currently displayed metrics, including the same FPS
// snapshot as the existing HUD. Plain text is easy to paste into a chat.
export function formatProfilerReport({status='',fps='',regionSize=3,
  geometry='',inventory='',shadow='',lights='',notes=[]}={}){
  return [
    'Geometry + Shadow Profiler',
    status,
    'Регион декора: '+regionSize+'×'+regionSize+' чанков',
    'Performance · FPS / CPU / GPU',fps,
    'Geometry · реальные отрисовки, текущий кадр',geometry,
    'Geometry · активная сцена (до отсечения камерой)',inventory,
    'Shadow · текущий кадр и среднее',shadow,
    'Shadow · последние обновления карт теней',lights,
    ...notes,
  ].join('\n\n');
}


// Only for index_debug.html. Opening the panel enables profiling, closing
// restores the original renderer method. Both tables refresh at most once/sec.
export function installProfilerPanel(ctx,profiler){
  const css=document.createElement('style');
  css.textContent=`
    #fc-profiler-toggle{position:fixed;z-index:18;top:190px;right:12px;
      border:1px solid #739682;background:#10251fee;border-radius:8px;
      padding:8px 10px;color:#d7ffe0;font:600 12px system-ui;cursor:pointer}
    #fc-profiler-panel{position:fixed;z-index:18;right:12px;top:230px;
      width:min(535px,calc(100vw - 24px));max-height:min(70vh,670px);
      overflow:auto;background:#081c16f2;border:1px solid #739682;
      border-radius:12px;padding:12px;color:#e3ffe9;box-shadow:0 8px 28px #0009;
      font:12px/1.4 system-ui}
    #fc-profiler-panel[hidden]{display:none}
    #fc-profiler-panel h3{font-size:14px;margin:0 0 8px}
    #fc-profiler-panel h4{font-size:12px;margin:12px 0 5px;color:#aff5c1}
    #fc-profiler-panel p{font-size:11px;color:#aac6b5;margin:5px 0}
    #fc-profiler-panel pre{font:11px/1.5 ui-monospace,monospace;margin:3px 0;
      padding:8px;background:#102920;border-radius:6px;overflow-x:auto}
    #fc-profiler-panel .line{display:flex;justify-content:space-between;gap:8px;align-items:center}
    #fc-profiler-panel button{padding:4px 8px;border-radius:6px}
    #fc-profiler-panel select{background:#19392d;color:#e3ffe9;
      border:1px solid #739682;border-radius:6px;padding:4px 8px}
    #fc-profiler-panel .controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
    #fc-profiler-panel [data-copy]{background:#236e4b;color:white;
      border:1px solid #83b49b;cursor:pointer}
    @media(max-width:650px){#fc-profiler-toggle{top:auto;bottom:210px;right:8px}
      #fc-profiler-panel{top:12vh;max-height:65vh}}
  `;
  const toggle=document.createElement('button');
  toggle.id='fc-profiler-toggle';toggle.type='button';
  toggle.textContent='📊 Geometry / Shadow';
  const panel=document.createElement('section');
  panel.id='fc-profiler-panel';panel.hidden=true;
  panel.setAttribute('aria-label','Профилировщик геометрии и теней');
  panel.innerHTML=`
    <div class="line"><h3>Geometry + Shadow Profiler</h3>
      <div class="controls"><button type="button" data-copy>📋 Скопировать</button>
        <button type="button" data-close aria-label="Закрыть профилировщик">✕</button></div></div>
    <p data-status>Ожидание первого кадра</p>
    <div class="controls"><label for="fc-profiler-region">Регион декора:</label>
      <select id="fc-profiler-region" data-region-size aria-label="Размер региона декора">
        <option value="1">1×1</option><option value="2">2×2</option>
        <option value="3">3×3</option><option value="5">5×5</option>
      </select><span>чанков</span></div>
    <h4>Performance · FPS / CPU / GPU</h4>
    <pre data-fps>—</pre>
    <h4>Geometry · реальные отрисовки, текущий кадр</h4>
    <pre data-geometry>—</pre>
    <h4>Geometry · активная сцена (до отсечения камерой)</h4>
    <pre data-inventory>—</pre>
    <h4>Shadow · текущий кадр и среднее</h4>
    <pre data-shadow>—</pre>
    <h4>Shadow · последние обновления карт теней</h4>
    <pre data-lights>—</pre>
    <p data-note>Треугольники и draw calls взяты из WebGLRenderer.info на каждом реальном draw.
      В геометрии сцены указана оценка потенциальных треугольников (включая инстансы
      вне камеры), не дополнительный draw call.</p>
    <p data-note>CPU ms — затраты CPU на отправку команд рендера теней, НЕ GPU ms.
      Тени могут обновляться раз в несколько секунд; последние обновления
      сохраняются с момента открытия панели. Скрытые/замороженные карты не
      считаются повторно.</p>`;
  document.body.append(css,toggle,panel);
  const pick=s=>panel.querySelector(s);
  const format=n=>Math.round(n).toLocaleString('ru-RU');
  const line=(name,draws,triangles,objects,instances)=>
    `${name.padEnd(17)} ${String(draws).padStart(5)}  ${format(triangles).padStart(11)}  ${String(objects).padStart(4)}  ${format(instances).padStart(6)}`;
  let visible=false,interval=null;
  const regionSelect=pick('[data-region-size]');
  const manager=ctx.decorBatchManager;
  regionSelect.value=String(manager?.size??3);
  regionSelect.disabled=!manager?.setSize;
  regionSelect.addEventListener('change',()=>{
    if(!manager?.setSize)return;
    if(manager.setSize(Number(regionSelect.value))){
      // Lifetime totals must contain only one batch configuration.
      profiler.stop();
      profiler.start();
      ctx.settings?.setProfilerSampling?.(true);
    }
    render();
  });
  function render(){
    if(!visible)return;
    const data=profiler.snapshot(ctx.scene);
    const g=data.frame;
    regionSelect.value=String(manager?.size??3);
    pick('[data-fps]').textContent=ctx.settings?.fpsReport??'—';
    pick('[data-status]').textContent=
      `Кадров: ${data.frames} · Профилирование ${data.uptimeSeconds} с · только эта debug-вкладка`;
    pick('[data-geometry]').textContent=[
      'Категория            Draws    Triangles   Mesh    Inst',
      ...g.main.filter(v=>v.drawCalls).sort((a,b)=>b.triangles-a.triangles)
        .map(v=>line(PROFILE_LABELS[v.category],v.drawCalls,v.triangles,v.meshes,v.instances)),
      line('ИТОГО (main)',g.mainDraws,g.mainTriangles,
        g.main.reduce((a,v)=>a+v.meshes,0),g.main.reduce((a,v)=>a+v.instances,0)),
    ].join('\n');
    pick('[data-inventory]').textContent=[
      'Категория             Mesh   Instances  Potential Tri  Geom',
      ...data.inventory.filter(v=>v.meshes).sort((a,b)=>b.trianglesPotential-a.trianglesPotential)
        .map(v=>`${PROFILE_LABELS[v.category].padEnd(17)} ${String(v.meshes).padStart(5)}  ${format(v.instances).padStart(10)}  ${format(v.trianglesPotential).padStart(13)} ${String(v.uniqueGeometries).padStart(5)}`),
    ].join('\n');
    pick('[data-shadow]').textContent=[
      `Этот кадр: ${format(g.shadowDraws)} draws · ${format(g.shadowTriangles)} tri`,
      `За период: ${format(data.shadowTotals.drawCalls)} draws · ${format(data.shadowTotals.triangles)} tri`,
      `Среднее/кадр: ${data.shadowTotals.callsPerFrame} draws · ${format(data.shadowTotals.trianglesPerFrame)} tri`,
      '',
      'По категориям (последний кадр):',
      ...g.shadow.filter(v=>v.drawCalls).sort((a,b)=>b.triangles-a.triangles)
        .map(v=>`${PROFILE_LABELS[v.category]}: ${format(v.drawCalls)} draws / ${format(v.triangles)} tri`),
    ].join('\n');
    pick('[data-lights]').textContent=data.lights.length
      ?data.lights.map(v=>`${v.label} · ${v.resolution?v.resolution.join('×'):'?'} · ${v.faces} граней\n`+
        `  обновлений ${v.refreshes} · последняя ${v.ageSeconds} с назад\n`+
        `  ${format(v.lastDrawCalls)} draws · ${format(v.lastTriangles)} tri · CPU ${v.lastCpuMs.toFixed(2)} ms`).join('\n\n')
      :'Обновлений теневых карт пока нет (ночью солнечные карты могут не обновляться).';
  }
  const copyButton=pick('[data-copy]');
  function copyCurrentReport(){
    render();
    return formatProfilerReport({
      status:pick('[data-status]').textContent,
      fps:pick('[data-fps]').textContent,
      regionSize:Number(regionSelect.value),
      geometry:pick('[data-geometry]').textContent,
      inventory:pick('[data-inventory]').textContent,
      shadow:pick('[data-shadow]').textContent,
      lights:pick('[data-lights]').textContent,
      notes:[...panel.querySelectorAll('[data-note]')]
        .map(node=>node.textContent.replace(/\s+/g,' ').trim()),
    });
  }
  function fallbackCopy(text){
    const input=document.createElement('textarea');
    input.value=text;input.setAttribute('readonly','');
    input.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';
    document.body.append(input);input.select();
    let copied=false;
    try{copied=document.execCommand?.('copy')===true;}catch{}
    input.remove();return copied;
  }
  copyButton.addEventListener('click',async()=>{
    const text=copyCurrentReport();
    let copied=false;
    try{
      if(navigator.clipboard?.writeText){
        await navigator.clipboard.writeText(text);
        copied=true;
      }
    }catch{}
    if(!copied)copied=fallbackCopy(text);
    copyButton.textContent=copied?'✓ Скопировано':'Не удалось скопировать';
    setTimeout(()=>{copyButton.textContent='📋 Скопировать';},1700);
  });
  function show(){
    if(visible)return;
    visible=true;panel.hidden=false;toggle.textContent='📊 Закрыть профайлер';
    ctx.settings?.setProfilerSampling?.(true);
    profiler.start();render();interval=setInterval(render,1000);
  }
  function hide(){
    if(!visible)return;
    visible=false;panel.hidden=true;toggle.textContent='📊 Geometry / Shadow';
    clearInterval(interval);interval=null;profiler.stop();
    ctx.settings?.setProfilerSampling?.(false);
  }
  toggle.addEventListener('click',()=>visible?hide():show());
  pick('[data-close]').addEventListener('click',hide);
  window.addEventListener('pagehide',()=>{hide();});
  return {show,hide,render,get visible(){return visible;}};
}
