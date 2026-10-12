/** Pure helpers for the home-page review sheet: compact JSON lines, a line diff and markup. */
const WIDTH = 80;
const esc = text => text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const token = key => String(key).replace(/~/g, '~0').replace(/\//g, '~1');

function inline(value) {
  if (Array.isArray(value)) return '[' + value.map(inline).join(', ') + ']';
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length ? '{ ' + entries.map(([k, v]) => JSON.stringify(k) + ': ' + inline(v)).join(', ') + ' }' : '{}';
  }
  return JSON.stringify(value);
}

/** Format JSON with short objects/arrays kept on one line. Each line records the JSON Pointer it starts. */
export function formatLines(value) {
  const out = [];
  (function walk(node, indent, pointer, prefix, comma) {
    const single = prefix + inline(node) + comma;
    if (!(node && typeof node === 'object') || (indent && indent.length + single.length <= WIDTH)) {
      out.push({ text: indent + single, pointer });
      return;
    }
    const array = Array.isArray(node);
    const entries = array ? node.map((v, i) => [i, v]) : Object.entries(node);
    out.push({ text: indent + prefix + (array ? '[' : '{'), pointer });
    entries.forEach(([k, v], i) => walk(v, indent + '  ', pointer + '/' + token(k), array ? '' : JSON.stringify(k) + ': ', i < entries.length - 1 ? ',' : ''));
    out.push({ text: indent + (array ? ']' : '}') + comma, pointer });
  })(value, '', '', '', '');
  return out;
}

/** Longest-common-subsequence line diff. Removed lines come before the lines that replace them. */
export function diffLines(before, after) {
  const n = before.length, m = after.length;
  const table = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    table[i][j] = before[i].text === after[j].text ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const rows = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && before[i].text === after[j].text) { rows.push({ type: 'same', old: i + 1, new: j + 1, ...after[j] }); i++; j++; }
    else if (i < n && (j === m || table[i + 1][j] >= table[i][j + 1])) { rows.push({ type: 'del', old: i + 1, ...before[i] }); i++; }
    else { rows.push({ type: 'add', new: j + 1, ...after[j] }); j++; }
  }
  return rows;
}

/** Index of the row a finding belongs to: the changed line whose pointer is the longest prefix of the finding path. */
export function rowForPath(rows, path) {
  const within = row => path === row.pointer || path.startsWith(row.pointer + '/') || row.pointer === '';
  for (const types of [['add'], ['del'], ['same']]) {
    let best = -1;
    rows.forEach((row, index) => {
      if (types.includes(row.type) && within(row) && (best < 0 || row.pointer.length > rows[best].pointer.length)) best = index;
    });
    if (best >= 0) return best;
  }
  return -1;
}

function highlight(text) {
  let html = '', last = 0;
  const pattern = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;
  for (const match of text.matchAll(pattern)) {
    html += esc(text.slice(last, match.index));
    if (match[1]) html += match[2] ? `<span class="tk-key">${esc(match[1])}</span>${match[2]}` : `<span class="tk-str">${esc(match[1])}</span>`;
    else html += `<span class="tk-num">${esc(match[0])}</span>`;
    last = match.index + match[0].length;
  }
  return html + esc(text.slice(last));
}

export function rowsHTML(rows) {
  const sign = { same: ' ', add: '+', del: '−' };
  return rows.map((row, index) => `<div class="diff-row is-${row.type}" data-row="${index}"><span class="ln">${row.old ?? ''}</span><span class="ln">${row.new ?? ''}</span><span class="sign" aria-hidden="true">${sign[row.type]}</span><code class="src">${highlight(row.text)}</code><span class="pins" aria-hidden="true"></span></div>`).join('');
}

export function diffStat(rows) {
  return { added: rows.filter(r => r.type === 'add').length, removed: rows.filter(r => r.type === 'del').length };
}
