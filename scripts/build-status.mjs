#!/usr/bin/env node
// Generates lib/status.generated.json for shopeye.in/status on every build.
// Status is derived from the repository, never edited by hand:
//   Done         - requirement ID cited exactly in implementation code (app/, components/, lib/, migrations)
//   In progress  - ID falls inside a range cited in implementation code (foundation exists, not complete)
//   Not started  - no reference
//   Tested       - ID proven by a passing test in docs/test-evidence.log (named in the test or via scripts/test-requirement-map.json)
// Each row also carries:
//   pages      - live pages where the functionality can be tried, derived from the citing files through the import graph
//   built      - what each citing file does for this requirement, taken from its own tag comment
//   groundwork - files whose ID ranges cover it (why an item shows In progress)
//   notes      - plain-language notes from docs/requirement-notes.json (what it does, how to check it, what it waits on)
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
    if (e.isDirectory()) walk(rel, out); else if (/\.(ts|tsx|sql|mjs|css)$/.test(e.name)) out.push(rel);
  }
  return out;
}

const matrix = parseCsv(read('docs/traceability-matrix.csv'));
const exact = new Map();   // id -> Set(files)
const ranged = new Map();
const files = [...walk('app'), ...walk('components'), ...walk('lib'), ...walk('supabase/migrations'), 'middleware.ts', 'next.config.mjs'].filter((f) => fs.existsSync(path.join(ROOT, f)));
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

// ---- Where can each file be seen? Follow imports from every route entry point.
const CODE = files.filter((f) => /\.(ts|tsx)$/.test(f));
const resolveImport = (from, spec) => {
  let base;
  if (spec.startsWith('@/')) base = spec.slice(2);
  else if (spec.startsWith('.')) base = path.join(path.dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) if (CODE.includes(c)) return c;
  return null;
};
const deps = new Map(CODE.map((f) => [f, [...read(f).matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => resolveImport(f, m[1])).filter(Boolean)]));
const LABELS = { '/': 'Home page', '/cart': 'Cart', '/checkout': 'Checkout', '/login': 'Sign in / sign up', '/search': 'Search', '/wishlist': 'Wishlist',
  '/compare': 'Compare', '/account': 'My account', '/account/orders': 'My orders', '/account/tickets': 'Help requests', '/support/new': 'Contact support',
  '/seller': 'Seller hub', '/admin': 'Admin console', '/admin/reviews': 'Review moderation (admin)' };
const DYNAMIC = { '/p/[id]': ['A product page', 'go:product'], '/c/[slug]': ['A category page', 'go:category'],
  '/account/orders/[id]': ['An order page', 'go:order'], '/[page]': ['Help and policy pages', '/help'] };
function entryTarget(f) {
  if (f === 'app/layout.tsx' || f === 'app/globals.css' || f === 'app/error.tsx') return { label: 'Every page (site-wide)', href: '/', kind: 'page' };
  if (f === 'app/not-found.tsx') return { label: 'Not-found page', href: 'go:missing-product', kind: 'page' };
  if (f === 'app/robots.ts') return { label: 'robots.txt', href: '/robots.txt', kind: 'page' };
  if (f === 'app/sitemap.ts') return { label: 'sitemap.xml', href: '/sitemap.xml', kind: 'page' };
  if (f === 'middleware.ts') return { label: 'Every request (middleware)', href: null, kind: 'server' };
  if (f === 'next.config.mjs') return { label: 'Every page (security headers)', href: '/', kind: 'page' };
  if (f.startsWith('supabase/migrations/')) return { label: 'Database rules (Supabase)', href: null, kind: 'database' };
  if (/^app\/.*route\.ts$/.test(f)) return { label: `Server endpoint ${f.slice(3).replace(/\/route\.ts$/, '')}`, href: null, kind: 'server' };
  const m = f.match(/^app\/(.*?)\/?page\.tsx$/);
  if (!m) return null;
  const route = '/' + m[1].split('/').filter((s) => s && !/^\(.*\)$/.test(s)).join('/');
  if (route.startsWith('/status')) return null;
  if (DYNAMIC[route]) return { label: DYNAMIC[route][0], href: DYNAMIC[route][1], kind: 'page' };
  return { label: LABELS[route] ?? route, href: route, kind: 'page' };
}
const ENTRIES = [...files.filter((f) => entryTarget(f)), 'app/layout.tsx'].filter((f, i, a) => a.indexOf(f) === i);
const reach = new Map(); // file -> Set(entry files that include it)
for (const e of ENTRIES) {
  const seen = new Set([e]), stack = [e];
  while (stack.length) { const f = stack.pop(); for (const d of deps.get(f) ?? []) if (!seen.has(d)) { seen.add(d); stack.push(d); } }
  for (const f of seen) { if (!reach.has(f)) reach.set(f, new Set()); reach.get(f).add(e); }
}
function pagesFor(fs_) {
  const out = new Map();
  for (const f of fs_) {
    const entries = reach.get(f) ?? new Set(entryTarget(f) ? [f] : []);
    const sitewide = entries.has('app/layout.tsx');
    for (const e of sitewide ? ['app/layout.tsx'] : entries) { const t = entryTarget(e); if (t) out.set(t.label, t); }
  }
  const order = { page: 0, server: 1, database: 2 };
  return [...out.values()].sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 6);
}
// ---- What does each citing file say it does for this ID? (our own tag comment, never SRS text)
const header = (f) => (read(f).match(/SHOPEYE \d{4} — ([^\n]+)/) ?? [])[1]?.replace(/\s*\(.*$/, '').replace(/\.\s*$/, '').trim();
function builtNote(f, id) {
  const line = read(f).split('\n').find((l) => l.includes(id));
  let note = '';
  if (line) {
    const c = line.replace(/^.*?(\/\/|--|\/\*)/, '').replace(/\*\/\s*$/, '');
    const paren = c.match(/\(((?:[^()]|\([^()]*\))*)\)\s*$/);
    note = (paren ? paren[1] : c).replace(RANGE, ' ').replace(ID, ' ').replace(/\b(SRS|Traces):/g, ' ').replace(/[\s,/;&—:-]+$/, '').replace(/^[\s,/;&—:-]+/, '').replace(/\s+/g, ' ').trim();
  }
  if (note.length < 12 || /^[§\d\s,.\/&A-Z-]*$/.test(note)) note = header(f) ?? '';
  return note ? note[0].toUpperCase() + note.slice(1) : '';
}
const notes = fs.existsSync(path.join(ROOT, 'docs/requirement-notes.json')) ? JSON.parse(read('docs/requirement-notes.json')) : {};

const known = new Set(matrix.map((r) => r['Requirement ID']));
const rows = matrix.map((r) => {
  const id = r['Requirement ID'];
  const isTested = tested.has(id);
  const status = exact.has(id) || isTested ? 'Done' : ranged.has(id) ? 'In progress' : 'Not started';
  return {
    id, portal: r['Portal'], section: r['SRS Section'], phase: r['Delivery Phase'], text: r['Requirement (extract)'],
    status, tested: isTested ? 'Passed' : 'Not tested',
    evidence: isTested ? tested.get(id).slice(0, 3) : [],
    files: [...(exact.get(id) ?? [])].slice(0, 6),
    groundwork: exact.has(id) ? [] : [...(ranged.get(id) ?? [])].slice(0, 3),
    pages: pagesFor([...(exact.get(id) ?? [])]),
    built: [...(exact.get(id) ?? [])].slice(0, 6).map((f) => ({ file: f, note: builtNote(f, id) })).filter((b) => b.note),
    notes: notes[id] ?? null,
  };
});
const unknownRefs = [...exact.keys(), ...tested.keys(), ...Object.keys(notes).filter((k) => k !== '_note')].filter((id) => !known.has(id));

const out = {
  generatedAt: new Date().toISOString(),
  commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null,
  evidenceAt, total: rows.length, unknownRefs: [...new Set(unknownRefs)], rows,
};
fs.writeFileSync(path.join(ROOT, 'lib/status.generated.json'), JSON.stringify(out));
const c = (f) => rows.filter(f).length;
console.log(`status: ${rows.length} requirements | done ${c((r) => r.status === 'Done')} | in progress ${c((r) => r.status === 'In progress')} | tested ${c((r) => r.tested === 'Passed')} | unknown refs ${out.unknownRefs.length}`);
