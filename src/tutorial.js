// Three real-event onboarding milestones. Entirely local; safe across solo and co-op.
export const TUTORIAL_KEY = 'forest-chopper:tutorial:v1';
const actions = ['tree-aimed', 'tree-fell', 'log-placed'];

export function advanceTutorial(stage, event) {
  if (!Number.isInteger(stage) || stage < 0 || stage >= actions.length) return stage;
  return actions[stage] === event ? stage + 1 : stage;
}

export function createTutorial({
  doc = document,
  storage = null,
  notify = () => {},
} = {}) {
  if (!storage) {
    try {storage = window.localStorage;} catch { /* Still usable for this tab. */ }
  }
  let stage = 0, skipped = false;
  try {
    const raw = storage?.getItem(TUTORIAL_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved?.version === 1 && Number.isInteger(saved.stage)
        && saved.stage >= 0 && saved.stage <= 3 && typeof saved.skipped === 'boolean') {
      stage = saved.stage;
      skipped = saved.skipped;
    }
  } catch { /* Invalid saved progress starts at the first step. */ }

  const style = doc.createElement('style');
  style.textContent = `
.fc-tutorial{position:fixed;left:16px;bottom:300px;z-index:8;width:min(285px,calc(100vw - 32px));background:#132b22ed;color:#f4fff8;border:1px solid #a7c3ae8a;border-radius:12px;padding:11px 13px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 6px 18px #0008}
.fc-tutorial[hidden]{display:none}
.fc-tutorial strong{display:block;font-size:13px;color:#b1f4ca}
.fc-tutorial p{margin:7px 0 9px;font-size:13px}
.fc-tutorial button{padding:5px 10px;border-radius:7px;font-size:12px}
@media(max-width:600px){.fc-tutorial{bottom:325px}}
@media(max-height:600px){.fc-tutorial{bottom:140px;max-height:calc(100dvh - 160px);overflow:auto}}
`;
  doc.head.append(style);
  const panel = doc.createElement('section');
  panel.className = 'fc-tutorial';
  panel.setAttribute('aria-label', 'Обучение Forest Chopper');
  const heading = doc.createElement('strong');
  const description = doc.createElement('p');
  const skip = doc.createElement('button');
  skip.type = 'button';
  skip.textContent = 'Пропустить обучение';
  panel.append(heading, description, skip);
  doc.body.append(panel);

  const mobile = typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;
  const steps = [
    'Подойдите к дереву и наведите прицел на ствол.',
    'Рубите дерево топором до тех пор, пока оно не упадёт.',
    mobile
      ? 'Нажмите 🏗️ Строить, затем 🪵 Положить, чтобы поставить первое бревно.'
      : 'Включите строительство (B) и поставьте первое бревно (E).',
  ];
  function render() {
    panel.hidden = skipped || stage >= 3;
    if (panel.hidden) return;
    heading.textContent = `🌲 Обучение · ${stage + 1}/3`;
    description.textContent = steps[stage];
  }
  function persist() {
    try {storage?.setItem(TUTORIAL_KEY, JSON.stringify({version:1,stage,skipped}));}
    catch { /* Blocked storage should not prevent playing. */ }
  }
  function complete(event) {
    if (skipped || stage >= 3) return false;
    const next = advanceTutorial(stage, event);
    if (next === stage) return false;
    stage = next;
    persist();
    render();
    if (stage === 3) notify('Обучение завершено!', 'success', 'tutorial-done');
    return true;
  }
  skip.onclick = () => {
    skipped = true;
    stage = 3;
    persist();
    render();
  };
  render();
  return {complete, get stage() {return stage;}, get skipped() {return skipped;}};
}
