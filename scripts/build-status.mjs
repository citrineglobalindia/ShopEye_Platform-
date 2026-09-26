#!/usr/bin/env node
// Generates lib/status.generated.json for shopeye.in/status on every build.
// Status is derived from the repository, never edited by hand:
//   Done         - requirement ID cited exactly in implementation code (app/, components/, lib/, migrations)
//   In progress  - ID falls inside a range cited in implementation code (foundation exists, not complete)
//   Not started  - no reference
//   Tested       - ID proven by a passing test in docs/test-evidence.log (named in the test or via scripts/test-requirement-map.json)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const ID = /(CUST|VS|SA|AF|SM|OPS)-FR-(\d{3,4})/g;
const RANGE = /((?:CUST|VS|SA|AF|SM|OPS)-FR-)(\d{3,4})\s*(?:\.\.|–|-)\s*(\d{3,4})\b/g;

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length >= head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
function walk(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out); else if (/\.(ts|tsx|sql|mjs)$/.test(e.name)) out.push(rel);
  }
  return out;
}

const matrix = parseCsv(read('docs/traceability-matrix.csv'));
const exact = new Map();   // id -> Set(files)
const ranged = new Map();
const files = [...walk('app'), ...walk('components'), ...walk('lib'), ...walk('supabase/migrations'), 'middleware.ts'].filter((f) => fs.existsSync(path.join(ROOT, f)));
for (const f of files) {
  let src = read(f);
  for (const [, pre, a, b] of src.matchAll(RANGE)) {
    const w = a.length;
    for (let n = +a; n <= +b; n++) { const id = pre + String(n).padStart(w, '0'); if (!ranged.has(id)) ranged.set(id, new Set()); ranged.get(id).add(f); }
  }
  src = src.replace(RANGE, ' ');
  for (const m of src.matchAll(ID)) { const id = m[0]; if (!exact.has(id)) exact.set(id, new Set()); exact.get(id).add(f); }
}

const tested = new Map();  // id -> [test names]
let evidenceAt = null;
const evPath = path.join(ROOT, 'docs/test-evidence.log');
if (fs.existsSync(evPath)) {
  evidenceAt = fs.statSync(evPath).mtime.toISOString();
  const map = JSON.parse(read('scripts/test-requirement-map.json'));
  for (const line of read('docs/test-evidence.log').split('\n')) {
    if (!line.startsWith('PASS')) continue;
    const name = line.replace(/^PASS\s+/, '').replace(/\s+\(rejected:.*$/, '').trim();
    const ids = new Set([...name.matchAll(ID)].map((m) => m[0]));
    for (const [k, v] of Object.entries(map)) if (k !== '_note' && name.includes(k)) v.forEach((x) => ids.add(x));
    for (const id of ids) { if (!tested.has(id)) tested.set(id, []); tested.get(id).push(name); }
  }
}

const known = new Set(matrix.map((r) => r['Requirement ID']));
const rows = matrix.map((r) => {
  const id = r['Requirement ID'];
  const isTested = tested.has(id);
  const status = exact.has(id) || isTested ? 'Done' : ranged.has(id) ? 'In progress' : 'Not started';
  return {
    id, portal: r['Portal'], section: r['SRS Section'], phase: r['Delivery Phase'], text: r['Requirement (extract)'],
    status, tested: isTested ? 'Passed' : 'Not tested',
    evidence: isTested ? tested.get(id).slice(0, 3) : [],
    files: [...(exact.get(id) ?? [])].slice(0, 3),
  };
});
const unknownRefs = [...exact.keys(), ...tested.keys()].filter((id) => !known.has(id));

const out = {
  generatedAt: new Date().toISOString(),
  commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null,
  evidenceAt, total: rows.length, unknownRefs: [...new Set(unknownRefs)], rows,
};
fs.writeFileSync(path.join(ROOT, 'lib/status.generated.json'), JSON.stringify(out));
const c = (f) => rows.filter(f).length;
console.log(`status: ${rows.length} requirements | done ${c((r) => r.status === 'Done')} | in progress ${c((r) => r.status === 'In progress')} | tested ${c((r) => r.tested === 'Passed')} | unknown refs ${out.unknownRefs.length}`);
