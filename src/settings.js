// Lightweight client-only preferences. No framework or new dependencies.
import {collectDiagnostics, formatDiagnostics} from './diagnostics.js';
const KEY = 'forest-chopper:settings:v1';
const DEFAULT = Object.freeze({mouseSensitivity: 1, showFps: false, windEnabled: true, fov: 75, dayCycleEnabled: false, autoSprint: false});

export function sanitizeSettings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const number = Number(source.mouseSensitivity);
  const fov = Number(source.fov);
  return {
    mouseSensitivity: Number.isFinite(number) && number >= .4 && number <= 2.5
      ? Math.round(number * 10) / 10 : DEFAULT.mouseSensitivity,
    showFps: source.showFps === true,
    windEnabled: source.windEnabled !== false,
    dayCycleEnabled: source.dayCycleEnabled === true,
    autoSprint: source.autoSprint === true,
    fov: Number.isFinite(fov) && fov >= 65 && fov <= 95
      ? Math.round(fov / 5) * 5 : DEFAULT.fov,
  };
}

export function createSettings(doc = document, storage = null, onFovChange = null) {
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
.fc-settings input[type=range]{display:block;width:100%;margin-top:8px;accent-color:#8bd0a4}
.fc-settings input[type=checkbox]{accent-color:#8bd0a4}
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
  fovSlider.oninput = () => {
    state.fov = sanitizeSettings({...state,fov:Number(fovSlider.value)}).fov;
    onFovChange?.(state.fov);
    reflect();save();
  };
  panel.querySelector('#fc-reset-settings').onclick = () => {
    Object.assign(state, DEFAULT);onFovChange?.(state.fov);reflect();save();
  };
  reflect();
  onFovChange?.(state.fov);

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
    get fov(){return state.fov;}, tick, close, setConnected, setLatency};
}
