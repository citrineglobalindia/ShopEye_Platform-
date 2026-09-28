// SRS: CUST-FR-031 CUST-FR-035 CUST-FR-036 CUST-FR-037 CUST-FR-038 (sort/filter keep scroll position; paged results with stable URLs; filters and sort in the URL; mobile filter drawer with Apply and Clear; removable filter chips)
import Link from 'next/link';
import { ProductGrid } from '@/components/ProductGrid';
import type { ListResult } from '@/lib/catalog';
import { inr } from '@/lib/config';
import { FilterBox } from '@/components/FilterBox';
import { SortSelect, FilterForm, MobileListBar, FilterSheetClose } from '@/components/ListingControls';

const SORTS: [string, string][] = [['', 'Relevance'], ['new', 'Newest first'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['discount', 'Biggest discount']];
const OFFS = [10, 20, 30, 40];
export type Params = Record<string, string | undefined>;
const qs = (p: Params, patch: Params) => { const u = new URLSearchParams(); Object.entries({ ...p, ...patch }).forEach(([k, v]) => v && u.set(k, v)); const s = u.toString(); return s ? `?${s}` : ''; };

export function Listing({ base, params, result, empty }: { base: string; params: Params; result: ListResult; empty: React.ReactNode }) {
  const chips: [string, string][] = [];
  if (params.min) chips.push(['min', `From ${inr(params.min)}`]);
  if (params.max) chips.push(['max', `Up to ${inr(params.max)}`]);
  if (params.off) chips.push(['off', `${params.off}% off or more`]);
  const f = result.facets;
  if (params.brand) chips.push(['brand', f?.brands.find((b) => b.value === params.brand)?.label ?? params.brand]);
  if (params.size) chips.push(['size', `Size ${params.size}`]);
  if (params.colour) chips.push(['colour', params.colour]);
  if (params.instock) chips.push(['instock', 'In stock only']);
  const keep = Object.entries(params).filter(([k]) => ['q'].includes(k));
  return (
    <div className="listing">
      <MobileListBar base={base} params={params} options={SORTS} filterCount={chips.length} />
      <aside className="filters" id="filters" aria-label="Filters">
        <FilterSheetClose />
        <FilterBox label={`Filters${chips.length ? ` (${chips.length})` : ''}`}>
          <FilterForm base={base}>
            {keep.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            {params.sort && <input type="hidden" name="sort" value={params.sort} />}
            <fieldset><legend>Price (₹)</legend>
              <div className="row2" style={{ gap: 8 }}>
                <label className="small">Min<input name="min" inputMode="numeric" defaultValue={params.min} placeholder="0" /></label>
                <label className="small">Max<input name="max" inputMode="numeric" defaultValue={params.max} placeholder={String(result.priceMax || '')} /></label>
              </div></fieldset>
            <fieldset><legend>Discount</legend>
              {OFFS.map((o) => <label key={o} className="radio"><input type="radio" name="off" value={o} defaultChecked={params.off === String(o)} /> {o}% or more</label>)}
              <label className="radio"><input type="radio" name="off" value="" defaultChecked={!params.off} /> Any</label>
            </fieldset>
            {!!f?.brands.length && <fieldset id="f-brand" tabIndex={-1}><legend>Brand</legend>
              {f.brands.slice(0, 12).map((b) => <label key={b.value} className="radio"><input type="radio" name="brand" value={b.value} defaultChecked={params.brand === b.value} /> {b.label} <span className="muted small">({b.count})</span></label>)}
              <label className="radio"><input type="radio" name="brand" value="" defaultChecked={!params.brand} /> Any</label></fieldset>}
            {!!f?.sizes.length && <fieldset><legend>Size</legend><div className="size-opts">
              {f.sizes.slice(0, 16).map((z) => <label key={z.value} className="size-opt"><input type="radio" name="size" value={z.value} defaultChecked={params.size === z.value} /><span>{z.label}</span></label>)}
              <label className="size-opt"><input type="radio" name="size" value="" defaultChecked={!params.size} /><span>Any</span></label></div></fieldset>}
            {!!f?.colours.length && <fieldset><legend>Colour</legend>
              {f.colours.slice(0, 12).map((c) => <label key={c.value} className="radio"><input type="radio" name="colour" value={c.value} defaultChecked={params.colour === c.value} /> {c.label} <span className="muted small">({c.count})</span></label>)}
              <label className="radio"><input type="radio" name="colour" value="" defaultChecked={!params.colour} /> Any</label></fieldset>}
            <fieldset><legend>Availability</legend><label className="radio"><input type="checkbox" name="instock" value="1" defaultChecked={!!params.instock} style={{ width: 'auto' }} /> In stock only</label></fieldset>
            <div className="cta-row"><button className="btn dark sm">Apply filters</button><Link className="btn ghost sm" scroll={false} href={base + qs({ q: params.q, sort: params.sort }, {})}>Clear</Link></div>
          </FilterForm>
        </FilterBox>
      </aside>
      <div className="stack" style={{ gap: 14 }}>
        <div className="list-bar">
          <span className="small muted" aria-live="polite" data-mcount={`${result.total.toLocaleString('en-IN')} Products`}>{result.total.toLocaleString('en-IN')} {result.total === 1 ? 'product' : 'products'}</span>
          <div className="sort-form"><SortSelect base={base} params={params} options={SORTS} /></div>
        </div>
        {chips.length > 0 && (
          <div className="chips" aria-label="Active filters">
            {chips.map(([k, l]) => <Link key={k} scroll={false} className="chip-x" href={base + qs(params, { [k]: undefined, page: undefined })} aria-label={`Remove filter ${l}`}>{l} <span aria-hidden="true">×</span></Link>)}
            <Link className="small" scroll={false} href={base + qs({ q: params.q }, {})}>Clear all</Link>
          </div>)}
        <ProductGrid items={result.items} empty={empty} />
        {result.pages > 1 && (
          <nav className="pager" aria-label="Pages">
            {result.page > 1 && <Link className="btn ghost sm" href={base + qs(params, { page: String(result.page - 1) })}>Previous</Link>}
            <span className="small">Page {result.page} of {result.pages}</span>
            {result.page < result.pages && <Link className="btn ghost sm" href={base + qs(params, { page: String(result.page + 1) })}>Next</Link>}
          </nav>)}
      </div>
    </div>
  );
}
export function parseList(sp: Params) {
  const n = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
  const sort = ['new', 'price_asc', 'price_desc', 'discount'].includes(sp.sort ?? '') ? (sp.sort as any) : undefined;
  const t = (v?: string) => (v && v.length <= 60 ? v : undefined);
  return { sort, min: n(sp.min), max: n(sp.max), off: n(sp.off), page: n(sp.page), brand: t(sp.brand), size: t(sp.size), colour: t(sp.colour), instock: sp.instock === '1' };
}
