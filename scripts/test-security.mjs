#!/usr/bin/env node
// Static and unit checks for server-side validation, output encoding, secrets and log redaction.
// Traces: CUST-FR-023 CUST-FR-169 CUST-FR-170 CUST-FR-174. Prints PASS/FAIL lines like docs/test-evidence.log.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let fail = 0; const check = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` (${detail})`}`); if (!ok) fail++; };
const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []);
const files = [...walk('app'), ...walk('components'), ...walk('lib'), 'middleware.ts'];
const src = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));

const raw = files.filter((f) => /dangerouslySetInnerHTML/.test(src[f]));
check(raw.every((f) => /application\/ld\+json[\s\S]{0,120}JSON\.stringify\([^)]*\)\.replace\(\/<\/g/.test(src[f])),
  'Raw HTML is only used for JSON-LD, and "<" is escaped there (CUST-FR-170 output encoding)', raw.join(' '));
check(!files.some((f) => /\.innerHTML\s*=|document\.write\(|\beval\(|new Function\(/.test(src[f])), 'No innerHTML, document.write, eval or new Function anywhere in the web app (CUST-FR-170)');
const secretUsers = files.filter((f) => /RAZORPAY_KEY_SECRET|SERVICE_ROLE|RAZORPAY_WEBHOOK_SECRET/.test(src[f]));
check(secretUsers.length > 0 && secretUsers.every((f) => /^import 'server-only'/m.test(src[f]) || /\/route\.ts$/.test(f)), 'Every file that reads a secret is a server route or a server-only module, so it can never ship to the browser (CUST-FR-169)', secretUsers.filter((f) => !/^import 'server-only'/m.test(src[f]) && !/\/route\.ts$/.test(f)).join(' '));
check(!files.some((f) => /NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE_ROLE|PRIVATE)/.test(src[f])), 'No secret is exposed through a NEXT_PUBLIC_ variable (CUST-FR-169)');
const clientFiles = files.filter((f) => /^'use client'/.test(src[f]));
check(!clientFiles.some((f) => /from '@\/lib\/(razorpay|sb-server|log)'/.test(src[f])), 'Browser components never import server-only modules');
const rawLogs = files.filter((f) => f !== 'lib/log.ts' && /console\.(log|error|warn|info)\(/.test(src[f]));
check(rawLogs.length === 0, 'All server logging goes through the redacting logger (CUST-FR-174)', rawLogs.join(' '));
const nextCfg = fs.readFileSync(path.join(ROOT, 'next.config.mjs'), 'utf8');
check(/e=link/.test(src['app/auth/callback/route.ts']) && /no-store/.test(src['app/auth/callback/route.ts']) && !/error\.message/.test(src['app/auth/callback/route.ts'])
  && /Referrer-Policy', value: 'strict-origin-when-cross-origin'/.test(nextCfg),
  'Sign-in link handler redirects to a clean, uncached URL with no raw auth error; other sites only ever see our origin as referrer (CUST-FR-023)');
check(!files.some((f) => /[?&](access_token|refresh_token)=/.test(src[f])), 'No code puts access or refresh tokens in a URL (CUST-FR-023)');

// Unit checks of the redactor itself (transpile-free: lib/log.ts is plain TS without types that need erasing beyond annotations)
const js = src['lib/log.ts'].replace(/: \[RegExp, string\]\[\]/, '').replace(/\(v: unknown\): string/, '(v)').replace(/\(where: string, \.\.\.parts: unknown\[\]\)/, '(where, ...parts)');
const tmp = path.join(ROOT, 'node_modules', '.log-test.mjs'); fs.writeFileSync(tmp, js);
const { redact } = await import(pathToFileURL(tmp).href);
const sample = 'user asha@example.com +91 98450 12345 otp 12345678 token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc card 4111 1111 1111 1111 key rzp_live_AbC123 sig ' + 'a'.repeat(64);
const out = redact(sample);
check(!/asha@|98450|12345678|eyJ|4111|rzp_live|aaaaaaaa/.test(out), 'Redactor removes emails, phone numbers, OTPs, tokens, card numbers, keys and signatures (CUST-FR-174)', out);
check(redact('Order not found') === 'Order not found', 'Redactor leaves ordinary messages readable');
fs.unlinkSync(tmp);
process.exit(fail ? 1 : 0);
