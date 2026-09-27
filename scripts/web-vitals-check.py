# Lab check of Core Web Vitals on key customer pages (CUST-FR-153): LCP, CLS and total blocking time on a
# phone-sized viewport with 4x CPU slowdown and a fast-3G-like network. Field data comes from real visits via
# the consented web_vital analytics event. Run against a production build: SHOPEYE_FIXTURES=1 npx next start -p 3101
import asyncio, os, sys
from playwright.async_api import async_playwright
B = os.environ.get('BASE', 'http://localhost:3101')
PAGES = ['/', '/search?q=saree', '/c/sarees', '/p/00000000-0000-4000-8000-000000000001', '/cart', '/login']
LIMITS = {'lcp': 2500, 'cls': 0.1, 'tbt': 300}
JS = """() => new Promise(res => { let lcp = 0, cls = 0, tbt = 0;
  new PerformanceObserver(l => { for (const e of l.getEntries()) lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver(l => { for (const e of l.getEntries()) tbt += Math.max(0, e.duration - 50); }).observe({ type: 'longtask', buffered: true });
  setTimeout(() => res({ lcp, cls, tbt }), 3000); })"""
async def main():
    fail = 0
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for u in PAGES:
            ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True)
            pg = await ctx.new_page(); cdp = await ctx.new_cdp_session(pg)
            await cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
            await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': 150, 'downloadThroughput': 1.6e6 / 8 * 1024 / 1000 * 1000, 'uploadThroughput': 750e3 / 8})
            await pg.goto(B + u, wait_until='load'); m = await pg.evaluate(JS)
            ok = m['lcp'] <= LIMITS['lcp'] and m['cls'] <= LIMITS['cls'] and m['tbt'] <= LIMITS['tbt']; fail += not ok
            print(f"{'PASS' if ok else 'FAIL'}  Core Web Vitals (lab, phone, 4x CPU, slow network) on {u}: LCP {m['lcp']:.0f} ms, CLS {m['cls']:.3f}, TBT {m['tbt']:.0f} ms")
            await ctx.close()
        await b.close()
    sys.exit(1 if fail else 0)
asyncio.run(main())
