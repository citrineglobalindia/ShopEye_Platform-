# Automated WCAG 2.2 AA check (axe-core) of customer pages at desktop and phone width.
# Needs: pip install playwright; python -m playwright install chromium; npm i --no-save axe-core;
# then run the app with demo data: SHOPEYE_FIXTURES=1 npx next start -p 3101, and: python3 scripts/a11y-audit.py
# Prints one PASS/FAIL line per page and width; exits non-zero on any violation.
import asyncio, json, os, sys
from playwright.async_api import async_playwright
AXE = open(os.path.join(os.path.dirname(__file__), '..', 'node_modules/axe-core/axe.min.js')).read()
P = '00000000-0000-4000-8000-000000000001'
PAGES = ['/', '/search?q=saree', '/c/sarees', f'/p/{P}', '/cart', '/login', '/help', '/returns-policy', '/compare', '/seller', '/status', '/status/CUST-FR-132', '/p/00000000-0000-0000-0000-000000000000']
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); total = 0
        for w in (1280, 375):
            pg = await b.new_page(viewport={'width': w, 'height': 900})
            for u in PAGES:
                await pg.goto(os.environ.get('BASE', 'http://localhost:3101') + u); await pg.wait_for_load_state('networkidle'); await pg.wait_for_timeout(400)
                await pg.add_script_tag(content=AXE)
                r = await pg.evaluate("axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}).then(r => r.violations.map(v => ({id: v.id, impact: v.impact, n: v.nodes.length, t: v.nodes.slice(0,2).map(n => n.target.join(' ') + ' :: ' + (n.failureSummary||'').split('\\n')[1]) })))")
                total += len(r)
                print(('PASS' if not r else 'FAIL') + f'  WCAG 2.2 AA (axe) no violations on {u} at {w}px' + ('' if not r else ' ' + json.dumps(r)[:600]))
        await b.close(); sys.exit(1 if total else 0)
asyncio.run(main())
