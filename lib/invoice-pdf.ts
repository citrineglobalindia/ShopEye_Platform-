// SRS: CUST-FR-104 CUST-FR-107 (printable GST tax invoice / credit note PDF; each document states the seller and exactly which items it covers)
import { Pdf } from './pdf';
const rs = (n: any) => 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const addr = (a: any) => [a?.recipient, a?.line1, a?.line2, a?.landmark, [a?.city, a?.state_code, a?.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
const IN_WORDS = (n: number) => {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x: number) => x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? ' ' + a[x % 10] : ''}`;
  const three = (x: number) => `${x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' : '') : ''}${two(x % 100)}`;
  let r = Math.floor(n); const p = Math.round((n - r) * 100); const parts: string[] = [];
  for (const [div, name] of [[1e7, 'Crore'], [1e5, 'Lakh'], [1e3, 'Thousand']] as const) { if (r >= div) { parts.push(`${three(Math.floor(r / div))} ${name}`); r %= div; } }
  if (r) parts.push(three(r));
  return `Rupees ${parts.join(' ') || 'Zero'}${p ? ` and ${two(p)} Paise` : ''} only`;
};

export function invoicePdf(doc: any): Uint8Array {
  const i = doc.invoice, lines: any[] = doc.lines ?? [], sup = i.supplier ?? {}, buy = i.buyer ?? {};
  const cn = i.kind === 'credit_note'; const intra = i.supply_type === 'intra';
  const pdf = new Pdf(); const L = pdf.left, R = pdf.right;
  pdf.text(cn ? 'CREDIT NOTE' : 'TAX INVOICE', L, pdf.y, 16, true);
  pdf.text('Original for recipient', R, pdf.y, 8, false, 'right'); pdf.y -= 22;
  pdf.text(`${cn ? 'Credit note' : 'Invoice'} no: ${i.number}`, L, pdf.y, 9, true);
  pdf.text(`Date: ${new Date(i.issued_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}`, R, pdf.y, 9, false, 'right'); pdf.y -= 13;
  pdf.text(`Order: ${doc.order_number}${cn && doc.original_number ? `   Against invoice: ${doc.original_number}` : ''}`, L, pdf.y, 9); pdf.y -= 13;
  pdf.text(`Place of supply: ${doc.place_of_supply_label ?? i.place_of_supply}   Supply: ${intra ? 'Intra-state (CGST + SGST)' : 'Inter-state (IGST)'}`, L, pdf.y, 9); pdf.y -= 18;
  const colW = (R - L) / 2 - 10; const top = pdf.y;
  pdf.text('Sold by', L, pdf.y, 8, true); pdf.y -= 12;
  pdf.para(sup.legal_name + (sup.trade_name && sup.trade_name !== sup.legal_name ? ` (${sup.trade_name})` : ''), L, colW, 9, true);
  pdf.para(`GSTIN: ${sup.gstin}`, L, colW, 9);
  if (addr(sup.address)) pdf.para(addr(sup.address), L, colW, 8);
  const leftEnd = pdf.y; pdf.y = top;
  const X = L + colW + 20;
  pdf.text('Bill to', X, pdf.y, 8, true); pdf.y -= 12;
  pdf.para(buy.name || 'Customer', X, colW, 9, true);
  if (buy.gstin) pdf.para(`GSTIN: ${buy.gstin}`, X, colW, 9);
  if (addr(buy.bill_to)) pdf.para(addr(buy.bill_to), X, colW, 8);
  pdf.text('Ship to', X, pdf.y - 2, 8, true); pdf.y -= 14;
  pdf.para(addr(buy.ship_to), X, colW, 8);
  pdf.y = Math.min(leftEnd, pdf.y) - 10;
  // Items table
  const cols = intra
    ? [['#', 18, 'l'], ['Item', 150, 'l'], ['HSN/SAC', 44, 'l'], ['Qty', 24, 'r'], ['Rate', 50, 'r'], ['Disc.', 40, 'r'], ['Taxable', 52, 'r'], ['GST%', 28, 'r'], ['CGST', 40, 'r'], ['SGST', 40, 'r'], ['Total', 0, 'r']]
    : [['#', 18, 'l'], ['Item', 190, 'l'], ['HSN/SAC', 44, 'l'], ['Qty', 24, 'r'], ['Rate', 50, 'r'], ['Disc.', 40, 'r'], ['Taxable', 52, 'r'], ['GST%', 28, 'r'], ['IGST', 40, 'r'], ['Total', 0, 'r']];
  const xs: number[] = []; let x = L; for (const c of cols) { xs.push(x); x += (c[1] as number) || (R - x); }
  const head = () => { pdf.rect(L, pdf.y - 4, R - L, 14, '0.93 0.94 0.97'); cols.forEach((c, k) => pdf.text(c[0] as string, c[2] === 'r' ? (xs[k + 1] ?? R) - 3 : xs[k] + 2, pdf.y, 7.5, true, c[2] === 'r' ? 'right' : 'left')); pdf.y -= 16; };
  head();
  lines.forEach((l, n) => {
    const desc = pdf.wrap(l.description, (cols[1][1] as number) - 4, 8);
    const h = Math.max(1, desc.length) * 10 + 4;
    if (pdf.y - h < 90) { pdf.newPage(); head(); }
    const vals = intra ? [String(n + 1), '', l.hsn ?? '', String(l.qty), n2(l.unit_price), n2(l.discount), n2(l.taxable_value), `${Number(l.gst_rate)}`, n2(l.cgst), n2(l.sgst), n2(l.line_total)]
                       : [String(n + 1), '', l.hsn ?? '', String(l.qty), n2(l.unit_price), n2(l.discount), n2(l.taxable_value), `${Number(l.gst_rate)}`, n2(l.igst), n2(l.line_total)];
    vals.forEach((v, k) => { if (k !== 1) pdf.text(v, cols[k][2] === 'r' ? (xs[k + 1] ?? R) - 3 : xs[k] + 2, pdf.y, 8, false, cols[k][2] === 'r' ? 'right' : 'left'); });
    desc.forEach((d, j) => pdf.text(d, xs[1] + 2, pdf.y - j * 10, 8));
    pdf.y -= h; pdf.line(L, pdf.y + 6, R, pdf.y + 6, 0.3);
  });
  pdf.ensure(110); pdf.y -= 6;
  const sum = (label: string, v: any, bold = false) => { pdf.text(label, R - 150, pdf.y, 9, bold); pdf.text(rs(v), R - 3, pdf.y, 9, bold, 'right'); pdf.y -= 13; };
  sum('Taxable value', i.taxable_total);
  if (intra) { sum('CGST', i.cgst_total); sum('SGST', i.sgst_total); } else sum('IGST', i.igst_total);
  pdf.line(R - 150, pdf.y + 9, R, pdf.y + 9);
  sum(cn ? 'Total credited' : 'Invoice total', i.total, true);
  pdf.y -= 4; pdf.para(IN_WORDS(Number(i.total)), L, R - L, 8, false);
  pdf.y -= 6;
  pdf.para(`Prices include GST. ${cn ? 'This credit note reduces the invoice above for returned or undelivered items; the refund itself is shown on your order page.' : 'This invoice covers only the items listed above, shipped by this seller.'} Sold through ShopEye (www.shopeye.in), an online marketplace. Tax is not payable on reverse charge. Computer-generated document; no signature required.`, L, R - L, 7.5);
  return pdf.build();
}
const n2 = (v: any) => Number(v || 0).toFixed(2);
