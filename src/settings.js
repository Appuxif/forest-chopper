// Lightweight client-only preferences. No framework or new dependencies.
import {collectDiagnostics, formatDiagnostics} from './diagnostics.js';
import {FPS_OPTIONS} from './frame-limiter.js';
const KEY = 'forest-chopper:settings:v1';
const DEFAULT = Object.freeze({mouseSensitivity: 1, showFps: false, windEnabled: true, fov: 75, dayCycleEnabled: false, autoSprint: false,quality: 'balanced', maxFps: 60, grassDensity: 25, grassDistance: 50, grassMinSize: 2.5, grassMaxSize: 5.5, grassWidth: 1, grassTurnMin: -30, grassTurnMax: 30});

export function sanitizeSettings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const number = Number(source.mouseSensitivity);
  const fov = Number(source.fov);
  const settings = {
    mouseSensitivity: Number.isFinite(number) && number >= .4 && number <= 2.5
      ? Math.round(number * 10) / 10 : DEFAULT.mouseSensitivity,
    showFps: source.showFps === true,
    windEnabled: source.windEnabled !== false,
    dayCycleEnabled: source.dayCycleEnabled === true,
    autoSprint: source.autoSprint === true,
    quality: ['low','balanced','high'].includes(source.quality) ? source.quality : DEFAULT.quality,
    maxFps: FPS_OPTIONS.includes(source.maxFps) ? source.maxFps : DEFAULT.maxFps,
    grassDensity: Number.isInteger(source.grassDensity) && source.grassDensity >= 1
      && source.grassDensity <= 50 ? source.grassDensity : DEFAULT.grassDensity,
    grassDistance: Number.isInteger(source.grassDistance) && source.grassDistance >= 12
      && source.grassDistance <= 100 ? source.grassDistance : DEFAULT.grassDistance,
    grassMinSize: Number.isFinite(source.grassMinSize) && source.grassMinSize >= 1
      && source.grassMinSize <= 8 ? Math.round(source.grassMinSize * 4) / 4 : DEFAULT.grassMinSize,
    grassMaxSize: Number.isFinite(source.grassMaxSize) && source.grassMaxSize >= 1
      && source.grassMaxSize <= 8 ? Math.round(source.grassMaxSize * 4) / 4 : DEFAULT.grassMaxSize,
    grassWidth: Number.isFinite(source.grassWidth) && source.grassWidth >= .25
      && source.grassWidth <= 4 ? Math.round(source.grassWidth * 4) / 4 : DEFAULT.grassWidth,
    grassTurnMin: Number.isInteger(source.grassTurnMin) && source.grassTurnMin >= -90
      && source.grassTurnMin <= 0 ? source.grassTurnMin : DEFAULT.grassTurnMin,
    grassTurnMax: Number.isInteger(source.grassTurnMax) && source.grassTurnMax >= 0
      && source.grassTurnMax <= 90 ? source.grassTurnMax : DEFAULT.grassTurnMax,
    fov: Number.isFinite(fov) && fov >= 65 && fov <= 95
      ? Math.round(fov / 5) * 5 : DEFAULT.fov,
  };
  if(settings.grassMinSize > settings.grassMaxSize)
    [settings.grassMinSize,settings.grassMaxSize] = [settings.grassMaxSize,settings.grassMinSize];
  return settings;
}

export function createSettings(doc = document, storage = null, onFovChange = null, onQualityChange = null) {
  let persisted;
  try {
    const local = storage ?? window.localStorage;
    persisted = JSON.parse(local.getItem(KEY) || 'null');
    storage = local;
  } catch {
    persisted = null;
    storage = null;
  }
  const state = sanitizeSettings(persisted);
  let connected = false, latency = null, lastRate = null, lastDiagnostics = '';
  const css = doc.createElement('style');
  css.textContent = `
.fc-settings-toggle{position:fixed;top:55px;right:16px;z-index:12;border-radius:9px;padding:9px 12px;font-size:12px}
.fc-settings{position:fixed;z-index:17;top:96px;right:12px;width:min(290px,calc(100vw - 24px));max-height:calc(100dvh - 116px);overflow-y:auto;background:#10251ff2;color:white;border:1px solid #ffffff55;border-radius:12px;padding:14px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 10px 25px #0009}
.fc-settings[hidden],.fc-fps[hidden]{display:none}
/* Onboarding takes priority: keep its text unobstructed until the player finishes/skips it. */
body:has(.fc-tutorial:not([hidden])) .fc-fps{display:none}
.fc-settings h2{font-size:15px;margin:0 0 12px}
.fc-settings label{display:block;margin:10px 0}
.fc-settings small{display:block;color:#bed7c6;line-height:1.35;margin:-5px 0 9px}
.fc-settings select{display:block;width:100%;padding:7px;background:#0c2619;color:white;border:1px solid #ffffff55;border-radius:6px;margin-top:6px}
.fc-settings input[type=range]{display:block;width:100%;margin-top:8px;accent-color:#8bd0a4}
.fc-settings input[type=checkbox]{accent-color:#8bd0a4}
.fc-angle-pair{display:block;height:32px;position:relative;margin-top:7px;touch-action:none}
.fc-angle-track{position:absolute;top:15px;left:8px;right:8px;height:4px;border-radius:4px;background:#466856}
.fc-settings .fc-angle-pair input[type=range]{position:absolute;left:0;top:3px;margin:0;width:100%;height:26px;background:transparent;appearance:none;-webkit-appearance:none;pointer-events:none;accent-color:transparent}
.fc-angle-pair input[type=range]::-webkit-slider-runnable-track{background:transparent;border:0}
.fc-angle-pair input[type=range]::-moz-range-track{background:transparent;border:0}
.fc-angle-pair input[type=range]::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:17px;height:23px;border:2px solid #143c25;border-radius:6px;background:#96e3aa;cursor:ew-resize;pointer-events:auto}
.fc-angle-pair input[type=range]::-moz-range-thumb{width:17px;height:23px;border:2px solid #143c25;border-radius:6px;background:#96e3aa;cursor:ew-resize;pointer-events:auto}
.fc-settings button{border-radius:7px;padding:7px 10px}
.fc-fps{position:fixed;z-index:5;top:320px;left:16px;max-width:calc(100vw - 32px);border-radius:6px;padding:6px 8px;background:#10251fe8;color:#baf1ca;font:600 11px/1.5 ui-monospace,monospace;white-space:pre-line;pointer-events:none}
@media(max-width:450px){.fc-settings{top:135px;max-height:calc(100dvh - 148px)}.fc-settings-toggle{top:95px;right:12px;padding:8px 10px}}
`;
  doc.head.append(css);
  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = 'fc-settings-toggle';
  toggle.textContent = '⚙ Настройки';
  toggle.setAttribute('aria-expanded', 'false');
  const panel = doc.createElement('section');
  panel.className = 'fc-settings';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Настройки игры');
  panel.innerHTML = `<h2>⚙ Настройки</h2>
    <label>Чувствительность обзора: <output id="fc-sensitivity-value"></output>
      <input id="fc-sensitivity" type="range" min="0.4" max="2.5" step="0.1"></label>
    <label>Качество графики
      <select id="fc-quality"><option value="low">Экономный (GPU)</option><option value="balanced">Сбалансированный</option><option value="high">Высокий</option></select></label>
    <small>Меняет разрешение 3D-рендера, не затрагивая мир и управление.</small>
    <label>Максимальный FPS
      <select id="fc-max-fps"><option value="30">30 FPS</option><option value="60">60 FPS</option>
      <option value="90">90 FPS</option><option value="120">120 FPS</option>
      <option value="144">144 FPS</option><option value="0">Без ограничения</option></select></label>
    <small>Ограничивает частоту отрисовки и обновления игры. По умолчанию 60 FPS.</small>
    <label>Плотность мелкой травы: <output id="fc-grass-density-value"></output>
      <input id="fc-grass-density" type="range" min="1" max="50" step="1"></label>
    <label>Дальность мелкой травы: <output id="fc-grass-distance-value"></output> м
      <input id="fc-grass-distance" type="range" min="12" max="100" step="1"></label>
    <label>Размер травинок: <output id="fc-grass-size-range-value"></output>
      <span class="fc-angle-pair" id="fc-grass-size-pair">
        <span class="fc-angle-track" id="fc-grass-size-track"></span>
        <input id="fc-grass-min-size" type="range" min="1" max="8" step="0.25"
          aria-label="Минимальный размер травинок">
        <input id="fc-grass-max-size" type="range" min="1" max="8" step="0.25"
          aria-label="Максимальный размер травинок">
      </span>
    </label>
    <label>Ширина травинок: <output id="fc-grass-width-value"></output>
      <input id="fc-grass-width" type="range" min="0.25" max="4" step="0.25"></label>
    <label>Разброс поворота травинок: <output id="fc-grass-turn-value"></output>
      <span class="fc-angle-pair" id="fc-grass-turn-pair">
        <span class="fc-angle-track" id="fc-grass-turn-track"></span>
        <input id="fc-grass-turn-min" type="range" min="-90" max="90" step="1"
          aria-label="Минимальный поворот, от -90 до 0 градусов">
        <input id="fc-grass-turn-max" type="range" min="-90" max="90" step="1"
          aria-label="Максимальный поворот, от 0 до 90 градусов">
      </span>
    </label>
    <small>Меняется сразу; высокая плотность и дальность могут увеличить нагрузку.</small>
    <label>Угол обзора (FOV): <output id="fc-fov-value"></output>°
      <input id="fc-fov" type="range" min="65" max="95" step="5"></label>
    <label title="Панель появляется после завершения или пропуска обучения"><input id="fc-show-fps" type="checkbox"> FPS и диагностика рендера (локально)</label>
    <label><input id="fc-auto-sprint" type="checkbox"> Автобег при движении</label>
    <label><input id="fc-wind-enabled" type="checkbox"> Лёгкий ветер в кронах</label>
    <label><input id="fc-day-cycle" type="checkbox"> Локальная смена дня и ночи</label>
    <small>Только визуально, цикл 8 минут. В сетевой игре у каждого своё время суток.</small>
    <button id="fc-reset-settings" type="button">Сбросить настройки</button>`;
  const fps = doc.createElement('div');
  fps.className = 'fc-fps';
  fps.setAttribute('aria-label', 'Частота кадров');
  fps.hidden = !state.showFps;
  fps.textContent = 'FPS —';
  doc.body.append(toggle, panel, fps);

  const range = panel.querySelector('#fc-sensitivity');
  const output = panel.querySelector('#fc-sensitivity-value');
  const checkbox = panel.querySelector('#fc-show-fps');
  const windCheckbox = panel.querySelector('#fc-wind-enabled');
  const sprintCheckbox = panel.querySelector('#fc-auto-sprint');
  const qualitySelect = panel.querySelector('#fc-quality');
  const fpsSelect = panel.querySelector('#fc-max-fps');
  const grassDensityInput = panel.querySelector('#fc-grass-density');
  const grassDistanceInput = panel.querySelector('#fc-grass-distance');
  const grassDensityValue = panel.querySelector('#fc-grass-density-value');
  const grassDistanceValue = panel.querySelector('#fc-grass-distance-value');
  const grassMinSizeInput = panel.querySelector('#fc-grass-min-size');
  const grassMaxSizeInput = panel.querySelector('#fc-grass-max-size');
  const grassWidthInput = panel.querySelector('#fc-grass-width');
  const grassSizeRangeValue = panel.querySelector('#fc-grass-size-range-value');
  const grassSizeTrack = panel.querySelector('#fc-grass-size-track');
  const grassWidthValue = panel.querySelector('#fc-grass-width-value');
  const grassTurnMinInput = panel.querySelector('#fc-grass-turn-min');
  const grassTurnMaxInput = panel.querySelector('#fc-grass-turn-max');
  const grassTurnValue = panel.querySelector('#fc-grass-turn-value');
  const grassTurnTrack = panel.querySelector('#fc-grass-turn-track');
  const dayCheckbox = panel.querySelector('#fc-day-cycle');
  const fovSlider = panel.querySelector('#fc-fov');
  const fovOutput = panel.querySelector('#fc-fov-value');
  const networkLabel = () => connected ? `Ping ${latency === null ? '—' : latency + ' ms'}` : 'offline';
  const renderFps = () => {fps.textContent = `FPS ${lastRate === null ? '—' : lastRate} · ${networkLabel()}${lastDiagnostics ? '\n'+lastDiagnostics : ''}`;};
  function reflect() {
    range.value = state.mouseSensitivity;
    output.textContent = String(state.mouseSensitivity.toFixed(1));
    checkbox.checked = state.showFps;
    windCheckbox.checked = state.windEnabled;
    dayCheckbox.checked = state.dayCycleEnabled;
    sprintCheckbox.checked = state.autoSprint;
    qualitySelect.value = state.quality;
    fpsSelect.value = String(state.maxFps);
    grassDensityInput.value = String(state.grassDensity);
    grassDistanceInput.value = String(state.grassDistance);
    grassDensityValue.textContent = String(state.grassDensity);
    grassDistanceValue.textContent = String(state.grassDistance);
    grassMinSizeInput.value = String(state.grassMinSize);
    grassMaxSizeInput.value = String(state.grassMaxSize);
    grassWidthInput.value = String(state.grassWidth);
    grassSizeRangeValue.textContent = state.grassMinSize + '× … ' + state.grassMaxSize + '×';
    const sizeLeft = (state.grassMinSize - 1) / 7 * 100;
    const sizeRight = (state.grassMaxSize - 1) / 7 * 100;
    grassSizeTrack.style.background = `linear-gradient(to right,#466856 ${sizeLeft}%,#9ce2ab ${sizeLeft}%,#9ce2ab ${sizeRight}%,#466856 ${sizeRight}%)`;
    grassWidthValue.textContent = state.grassWidth + '×';
    grassTurnMinInput.value = String(state.grassTurnMin);
    grassTurnMaxInput.value = String(state.grassTurnMax);
    grassTurnValue.textContent = state.grassTurnMin+'° … +'+state.grassTurnMax+'°';
    const left = (state.grassTurnMin + 90) / 180 * 100;
    const right = (state.grassTurnMax + 90) / 180 * 100;
    grassTurnTrack.style.background = `linear-gradient(to right,#466856 ${left}%,#9ce2ab ${left}%,#9ce2ab ${right}%,#466856 ${right}%)`;
    fovSlider.value = String(state.fov);
    fovOutput.textContent = String(state.fov);
    fps.hidden = !state.showFps;
    renderFps();
  }
  function save() {
    try {storage?.setItem(KEY, JSON.stringify(state));}
    catch { /* Private mode or blocked storage: keep preferences for this tab. */ }
  }
  function close() {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded','false');
  }
  toggle.onclick = () => {
    if (!panel.hidden) {close();return;}
    doc.getElementById('network').style.display = 'none';
    panel.hidden = false;
    toggle.setAttribute('aria-expanded','true');
  };
  range.oninput = () => {
    Object.assign(state, sanitizeSettings({...state, mouseSensitivity: Number(range.value)}));
    reflect();save();
  };
  checkbox.onchange = () => {state.showFps = checkbox.checked;reflect();save();};
  windCheckbox.onchange = () => {state.windEnabled = windCheckbox.checked;reflect();save();};
  dayCheckbox.onchange = () => {state.dayCycleEnabled = dayCheckbox.checked;reflect();save();};
  sprintCheckbox.onchange = () => {state.autoSprint = sprintCheckbox.checked;reflect();save();};
  qualitySelect.onchange = () => {state.quality = sanitizeSettings({...state,quality:qualitySelect.value}).quality;onQualityChange?.(state.quality);reflect();save();};
  fpsSelect.onchange = () => {
    state.maxFps = sanitizeSettings({...state,maxFps:Number(fpsSelect.value)}).maxFps;
    lastSample=null;frames=0;lastRate=null;
    reflect();save();
  };
  grassDensityInput.oninput = () => {
    state.grassDensity = sanitizeSettings({...state, grassDensity:Number(grassDensityInput.value)}).grassDensity;
    reflect();save();
  };
  grassDistanceInput.oninput = () => {
    state.grassDistance = sanitizeSettings({...state, grassDistance:Number(grassDistanceInput.value)}).grassDistance;
    reflect();save();
  };
  grassMinSizeInput.oninput = () => {
    const value = Number(grassMinSizeInput.value);
    state.grassMinSize = Math.min(value,state.grassMaxSize);
    reflect();save();
  };
  grassMaxSizeInput.oninput = () => {
    const value = Number(grassMaxSizeInput.value);
    state.grassMaxSize = Math.max(value,state.grassMinSize);
    reflect();save();
  };
  grassWidthInput.oninput = () => {
    state.grassWidth = sanitizeSettings({...state,grassWidth:Number(grassWidthInput.value)}).grassWidth;
    reflect();save();
  };
  grassTurnMinInput.oninput = () => {
    state.grassTurnMin = Math.max(-90,Math.min(0,Number(grassTurnMinInput.value)));
    reflect();save();
  };
  grassTurnMaxInput.oninput = () => {
    state.grassTurnMax = Math.max(0,Math.min(90,Number(grassTurnMaxInput.value)));
    reflect();save();
  };
  fovSlider.oninput = () => {
    state.fov = sanitizeSettings({...state,fov:Number(fovSlider.value)}).fov;
    onFovChange?.(state.fov);
    reflect();save();
  };
  panel.querySelector('#fc-reset-settings').onclick = () => {
    Object.assign(state, DEFAULT);onFovChange?.(state.fov);onQualityChange?.(state.quality);reflect();save();
  };
  reflect();
  onFovChange?.(state.fov);
  onQualityChange?.(state.quality);

  let lastSample = null, frames = 0;
  function setConnected(online) {
    connected = !!online;
    latency = null;
    renderFps();
  }
  function setLatency(ms) {
    latency = connected && Number.isFinite(ms) && ms >= 0 && ms <= 120000 ? Math.round(ms) : null;
    renderFps();
  }
  function tick(now, gameCtx = null) {
    if (!state.showFps) {lastSample = null;frames = 0;lastDiagnostics='';return;}
    if (lastSample === null) {lastSample = now;frames = 0;return;}
    frames++;
    if (now - lastSample >= 950) {
      const rate = Math.round(frames * 1000 / (now - lastSample));
      lastRate = Math.max(0, rate);
      lastDiagnostics = gameCtx ? formatDiagnostics(collectDiagnostics(gameCtx)) : '';
      renderFps();
      frames = 0;
      lastSample = now;
    }
  }
  return {get mouseSensitivity(){return state.mouseSensitivity;},
    get showFps(){return state.showFps;},
    get windEnabled(){return state.windEnabled;},
    get dayCycleEnabled(){return state.dayCycleEnabled;},
    get autoSprint(){return state.autoSprint;},
    get fov(){return state.fov;},
    get quality(){return state.quality;},
    get maxFps(){return state.maxFps;},
    get grassDensity(){return state.grassDensity;},
    get grassDistance(){return state.grassDistance;},
    get grassMinSize(){return state.grassMinSize;},
    get grassMaxSize(){return state.grassMaxSize;},
    get grassWidth(){return state.grassWidth;},
    get grassTurnMin(){return state.grassTurnMin;},
    get grassTurnMax(){return state.grassTurnMax;},
    tick, close, setConnected, setLatency};
}
