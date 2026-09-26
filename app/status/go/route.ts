import { NextResponse } from 'next/server';
import { sbServer, sbPublic } from '@/lib/sb-server';
import { FIXTURES, listCategories } from '@/lib/catalog';
import { FIX_PRODUCTS } from '@/lib/fixtures';
export const dynamic = 'force-dynamic';

// "Try it" links on /status pages point at live examples that change over time (a product, a category, the
// viewer's latest order). This resolves them at click time so links never go stale. Only fixed targets, and
// only same-site paths, can come out of here.
const SAFE_QS = /^[a-z_]+=[\w.%-]+(&[a-z_]+=[\w.%-]+)*$/;
const SAFE_HASH = /^[a-z][\w-]{0,30}$/;
export async function GET(req: Request) {
  const u = new URL(req.url);
  const to = u.searchParams.get('to'), qs = u.searchParams.get('qs') ?? '', h = u.searchParams.get('h') ?? '';
  const tail = (SAFE_QS.test(qs) ? `?${qs}` : '') + (SAFE_HASH.test(h) ? `#${h}` : '');
  // found=false means there is nothing live to show yet (e.g. no products published): land on the nearest useful page
  let dest = '/', found = true;
  try {
    if (to === 'product') {
      const id = FIXTURES ? FIX_PRODUCTS[0]?.product_id
        : (await sbPublic().from('products').select('id').eq('status', 'active').order('published_at', { ascending: false }).limit(1).maybeSingle()).data?.id;
      found = !!id; dest = id ? `/p/${id}` : '/search';
    } else if (to === 'category') {
      const slug = (await listCategories())[0]?.slug;
      found = !!slug; dest = slug ? `/c/${slug}` : '/';
    } else if (to === 'order') {
      const db = await sbServer();
      const { data: { user } } = await db.auth.getUser();
      if (!user) dest = '/login?next=/account/orders';
      else {
        const { data } = await db.from('orders').select('id').eq('customer_id', user.id).order('placed_at', { ascending: false }).limit(1).maybeSingle();
        dest = data ? `/account/orders/${data.id}` : '/account/orders';
      }
    } else if (to === 'missing-product') dest = '/p/00000000-0000-0000-0000-000000000000';
    else found = false;
  } catch { found = false; dest = to === 'product' ? '/search' : '/'; }
  const res = NextResponse.redirect(new URL(dest + (found && !dest.includes('?') ? tail : ''), u.origin), 302);
  res.headers.set('cache-control', 'private, no-store'); res.headers.set('x-robots-tag', 'noindex');
  return res;
}
