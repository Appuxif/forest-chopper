import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotifications} from '../src/notifications.js';

function fixture() {
  let clock = 100, seq = 0;
  const timers = new Map();
  const element = tag => ({
    tag, children: [], dataset: {}, attributes: {}, className: '', textContent: '',
    classList: {items: new Set(), add(v) {this.items.add(v);}},
    append(node) {node.parent = this; this.children.push(node);},
    remove() {if (!this.parent) return; const children=this.parent.children;
      const index=children.indexOf(this); if(index!==-1)children.splice(index,1); this.parent=null;},
    setAttribute(name,value) {this.attributes[name]=value;},
  });
  const doc = {head: element('head'),body: element('body'),createElement: element};
  const notify = createNotifications({
    doc, now: () => clock,
    setTimer(fn, delay) {const id=++seq; timers.set(id,{fn, due:clock+delay});return id;},
    clearTimer(id) {timers.delete(id);},
  });
  function advance(ms) {
    const end=clock+ms;
    while (true) {
      const next=[...timers].sort((a,b)=>a[1].due-b[1].due)[0];
      if (!next || next[1].due>end) break;
      clock=next[1].due;timers.delete(next[0]);next[1].fn();
    }
    clock=end;
  }
  return {doc, notify, advance};
}

test('toasts display at most three, do not capture inputs, and deduplicate repeats', () => {
  const {doc,notify,advance}=fixture();
  const container=doc.body.children[0];
  assert.equal(container.attributes['aria-live'],'polite');
  assert.match(doc.head.children[0].textContent,/pointer-events:none/);
  assert.equal(notify.notify('Not enough wood','warning'),true);
  assert.equal(notify.notify('Not enough wood','warning'),false);
  assert.equal(container.children.length,1);
  advance(1200);
  assert.equal(notify.notify('Not enough wood','warning'),true);
  notify.notify('Built','success');
  notify.notify('Collected','info');
  assert.equal(container.children.length,3);
  assert.deepEqual(container.children.map(e=>e.textContent), ['Not enough wood','Built','Collected']);
  assert.equal(container.children[1].dataset.type,'success');
  notify.clear();
  assert.equal(notify.visibleCount,0);
  assert.equal(container.children.length,0);
});

test('toasts expire after delay and remove themselves after CSS fade', () => {
  const {doc,notify,advance}=fixture();
  const container=doc.body.children[0];
  notify.notify('Message');
  const element=container.children[0];
  advance(2699);
  assert.equal(notify.visibleCount,1);
  advance(1);
  assert.equal(notify.visibleCount,0);
  assert.equal(element.classList.items.has('fc-closing'),true);
  advance(210);
  assert.equal(container.children.length,0);
  assert.equal(notify.notify('', 'info'),false);
});

test('deduplication cache is bounded even with many unique events', () => {
  const {doc,notify}=fixture();
  for(let i=0;i<500;i++)notify.notify('Message '+i);
  assert.equal(notify.visibleCount,3);
  assert.equal(doc.body.children[0].children.length,3);
});
