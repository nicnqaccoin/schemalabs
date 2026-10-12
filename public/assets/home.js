import { baselineSchema, candidateSchema } from './samples.js';
import { formatLines, diffLines, rowForPath, rowsHTML, diffStat } from './diff-view.js';
const $ = id => document.getElementById(id);
const run = $('demo-run'), result = $('demo-result'), detail = $('demo-detail');
const view = $('demo-diff'), list = $('demo-findings'), stat = $('demo-stat'), sheet = $('review-sheet');
const choices = [$('demo-tightened'), $('demo-unchanged')];
let changed = true, worker = null, timer = null, busy = false, rows = [];
const labels = { breaking: 'Breaking', review: 'Review', compatible: 'Compatible' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function setState(state) { sheet.dataset.state = state; }
function draw() {
  rows = diffLines(formatLines(baselineSchema), formatLines(changed ? candidateSchema : baselineSchema));
  view.innerHTML = rowsHTML(rows);
  const { added, removed } = diffStat(rows);
  stat.replaceChildren();
  if (added || removed) stat.append(el('span', 'stat-add', `+${added}`), el('span', 'stat-del', `−${removed}`));
  else stat.append(el('span', '', 'identical'));
}
function placeholder() {
  list.replaceChildren(...[0, 1, 2].map(() => {
    const li = el('li', 'finding is-placeholder'); li.setAttribute('aria-hidden', 'true');
    li.append(el('span', 'skeleton-line short'), el('span', 'skeleton-line')); return li;
  }));
}
function focusRow(index, on) { view.querySelector(`[data-row="${index}"]`)?.classList.toggle('is-focus', on); }
function annotate(changes) {
  const items = changes.map(change => ({ ...change, row: rowForPath(rows, change.path) })).sort((a, b) => a.row - b.row);
  list.replaceChildren();
  if (!items.length) {
    const li = el('li', 'finding is-clean');
    li.append(el('span', 'clean-mark', '✓'), el('span', '', 'No reviewed rule changed between these two revisions.'));
    list.append(li); return;
  }
  items.forEach((item, i) => {
    const n = String(i + 1);
    const pins = view.querySelector(`[data-row="${item.row}"] .pins`);
    if (pins) pins.append(el('span', `pin ${item.severity}`, n));
    const li = el('li', 'finding'), copy = el('div', 'finding-copy');
    copy.append(el('code', 'finding-path', item.path), el('span', 'finding-message', item.message));
    li.append(el('span', `pin ${item.severity}`, n), el('span', `tag ${item.severity}`, labels[item.severity] || item.severity), copy);
    li.addEventListener('mouseenter', () => focusRow(item.row, true));
    li.addEventListener('mouseleave', () => focusRow(item.row, false));
    list.append(li);
  });
}
function done() {
  clearTimeout(timer); busy = false; run.disabled = false; run.textContent = 'Run again';
  for (const b of choices) b.disabled = false;
  worker?.terminate(); worker = null;
}
function check() {
  if (busy) return;
  busy = true; run.disabled = true; for (const b of choices) b.disabled = true;
  run.textContent = 'Checking…'; result.textContent = 'Comparing locally…'; detail.textContent = 'Ajv engine · browser worker';
  setState('busy'); draw(); placeholder();
  const start = performance.now();
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.error) { setState('error'); result.textContent = 'Check could not complete.'; detail.textContent = data.error; list.replaceChildren(); }
      else {
        const x = data.result;
        setState(x.breaking ? 'breaking' : x.changes.length ? 'review' : 'clean');
        result.textContent = x.breaking ? `${x.breaking} breaking changes found.` : x.changes.length ? `${x.changes.length} changes to review.` : 'No structural changes detected.';
        detail.textContent = `${x.changes.length} ${x.changes.length === 1 ? 'finding' : 'findings'} · ${Math.round(performance.now() - start)} ms · in your browser`;
        annotate(x.changes);
      }
      done();
    };
    worker.onerror = e => { e.preventDefault(); setState('error'); result.textContent = 'Try the full playground.'; detail.textContent = 'The sample worker could not start.'; list.replaceChildren(); done(); };
    timer = setTimeout(() => { setState('error'); result.textContent = 'The check timed out.'; detail.textContent = 'Try again or open the full playground.'; list.replaceChildren(); done(); }, 8000);
    worker.postMessage({ id: 1, mode: 'compare', left: baselineSchema, right: changed ? candidateSchema : baselineSchema });
  } catch (e) { setState('error'); result.textContent = 'Try the full playground.'; detail.textContent = e.message; done(); }
}
function select(next) {
  if (busy || next === changed) return;
  changed = next;
  choices[0].setAttribute('aria-pressed', String(next)); choices[1].setAttribute('aria-pressed', String(!next));
  check();
}
choices[0].addEventListener('click', () => select(true));
choices[1].addEventListener('click', () => select(false));
run.addEventListener('click', check);
window.addEventListener('pagehide', () => { clearTimeout(timer); worker?.terminate(); });
check();
