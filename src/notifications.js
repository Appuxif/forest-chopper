// Small self-contained, dependency-free toast HUD shared by both HTML entrypoints.
// No analytics or persistence; all notifications are local to this browser tab.
export function createNotifications({
  doc = document,
  now = () => performance.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = id => clearTimeout(id),
} = {}) {
  const style = doc.createElement('style');
  style.textContent = `
.fc-toasts{position:fixed;left:50%;bottom:calc(195px + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);width:min(320px,calc(100vw - 32px));display:flex;flex-direction:column;align-items:center;gap:7px;z-index:10010;pointer-events:none}
.fc-toast{max-width:100%;padding:9px 14px;border-radius:10px;background:#132920ec;color:#f3fff8;border:1px solid #9ab9a375;box-shadow:0 5px 16px #0008;font:600 13px/1.35 system-ui,sans-serif;text-align:center;text-shadow:0 1px 2px #000b;animation:fc-toast-in .18s ease-out;transition:opacity .2s ease,transform .2s ease}
.fc-toast[data-type="success"]{border-color:#83d3a3;background:#19392ceb}
.fc-toast[data-type="warning"]{border-color:#ffbf71;background:#432c19f2}
.fc-toast.fc-closing{opacity:0;transform:translateY(-7px)}
@keyframes fc-toast-in{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:600px){.fc-toasts{bottom:calc(250px + env(safe-area-inset-bottom, 0px))}}
@media(prefers-reduced-motion:reduce){.fc-toast{animation:none;transition:none}}
`;
  doc.head.append(style);
  const stack = doc.createElement('div');
  stack.className = 'fc-toasts';
  stack.setAttribute('role', 'status');
  stack.setAttribute('aria-live', 'polite');
  stack.setAttribute('aria-atomic', 'false');
  doc.body.append(stack);

  const visible = [];
  const recent = new Map();
  function dismiss(item, immediate = false) {
    if (!item || !visible.includes(item)) return;
    visible.splice(visible.indexOf(item), 1);
    clearTimer(item.timer);
    if (immediate) { item.element.remove(); return; }
    item.element.classList.add('fc-closing');
    setTimer(() => item.element.remove(), 210);
  }
  function notify(message, type = 'info', key = message) {
    const text = String(message ?? '').trim();
    if (!text) return false;
    const kind = ['info', 'warning', 'success'].includes(type) ? type : 'info';
    const unique = String(key);
    const timestamp = now();
    if (timestamp - (recent.get(unique) ?? -Infinity) < 1200) return false;
    recent.set(unique, timestamp);
    // Never accumulate historical keys indefinitely during a long session.
    if (recent.size > 80) recent.delete(recent.keys().next().value);
    while (visible.length >= 3) dismiss(visible[0], true);
    const element = doc.createElement('div');
    element.className = 'fc-toast';
    element.dataset.type = kind;
    element.textContent = text;
    stack.append(element);
    const item = {element, timer: null};
    visible.push(item);
    item.timer = setTimer(() => dismiss(item), 2700);
    return true;
  }
  function clear() {
    for (const item of [...visible]) dismiss(item, true);
    recent.clear();
  }
  return {notify, clear, get visibleCount() {return visible.length;}};
}
