#!/usr/bin/env node
// Checks docs/requirement-notes.json and the generated status data behind the /status "Functionality" panel.
// Prints PASS/FAIL lines in the same style as docs/test-evidence.log. Run after scripts/build-status.mjs.
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const notes = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/requirement-notes.json'), 'utf8'));
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/status.generated.json'), 'utf8'));
let fail = 0; const check = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` (${detail})`}`); if (!ok) fail++; };

// Routes that exist in the app (page.tsx files, route groups stripped) plus generated files and info slugs
const routes = new Set(['/robots.txt', '/sitemap.xml']);
(function walk(dir) { for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
  const rel = path.join(dir, e.name);
  if (e.isDirectory()) walk(rel); else if (e.name === 'page.tsx') routes.add('/' + rel.slice(4, -9).split('/').filter((s) => s && !/^\(.*\)$/.test(s)).join('/'));
} })('app');
const slugs = [...fs.readFileSync(path.join(ROOT, 'lib/info-pages.ts'), 'utf8').matchAll(/^\s*'?([a-z-]+)'?\s*:\s*\{\s*title/gm)].map((m) => m[1]);
slugs.forEach((s) => routes.add('/' + s));
const GO = ['product', 'category', 'order', 'missing-product'];
const validHref = (h) => h.startsWith('go:') ? GO.includes(h.slice(3).split(/[?#]/)[0]) : routes.has(h.split(/[?#]/)[0]);

const cust = data.rows.filter((r) => r.portal === 'Customer Website');
const ids = Object.keys(notes).filter((k) => k !== '_note');
check(cust.every((r) => notes[r.id]), `Every Customer Website requirement has a functionality note (${ids.length}/${cust.length})`, cust.filter((r) => !notes[r.id]).map((r) => r.id).join(' '));
check(ids.every((id) => data.rows.some((r) => r.id === id)), 'Every note belongs to a real SRS requirement ID');
check(ids.every((id) => notes[id].what?.length > 20 && notes[id].check?.length > 0), 'Every note says what the functionality does and how to check it');
const bad = ids.flatMap((id) => (notes[id].try ?? []).filter((l) => !validHref(l.href)).map((l) => `${id}:${l.href}`));
check(bad.length === 0, 'Every "Try it" link in the notes points at a page that exists', bad.join(' '));
const derivedBad = data.rows.flatMap((r) => (r.pages ?? []).filter((p) => p.href && !validHref(p.href)).map((p) => `${r.id}:${p.href}`));
check(derivedBad.length === 0, 'Every page derived from the code points at a page that exists', [...new Set(derivedBad)].slice(0, 5).join(' '));
const notDone = cust.filter((r) => r.status !== 'Done');
check(notDone.every((r) => notes[r.id].what.startsWith('Planned') && notes[r.id].next), `Unfinished requirements are labelled Planned and say what they wait on (${notDone.length})`, notDone.filter((r) => !(notes[r.id].what.startsWith('Planned') && notes[r.id].next)).map((r) => r.id).join(' '));
const done = cust.filter((r) => r.status === 'Done');
check(done.every((r) => !notes[r.id].what.startsWith('Planned')), `Finished requirements are not described as planned (${done.length})`, done.filter((r) => notes[r.id].what.startsWith('Planned')).map((r) => r.id).join(' '));
check(data.rows.filter((r) => r.files.length).every((r) => r.pages.length > 0), 'Every requirement cited in code shows where it lives (page, server or database)');
check(data.rows.filter((r) => r.status === 'In progress').every((r) => r.groundwork.length > 0), 'Every In progress requirement names the groundwork behind it');
const leak = ids.filter((id) => { const t = data.rows.find((r) => r.id === id)?.text ?? ''; return t.length > 40 && JSON.stringify(notes[id]).includes(t.slice(0, 40)); });
check(leak.length === 0, 'Notes are written in our own words, never copied from the confidential SRS text', leak.join(' '));
process.exit(fail ? 1 : 0);
