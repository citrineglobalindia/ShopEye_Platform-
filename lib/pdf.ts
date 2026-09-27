// Minimal dependency-free PDF writer for tax documents: A4 pages, Helvetica / Helvetica-Bold, text, lines and boxes.
// Text is WinAnsi (Latin-1); characters outside it are replaced, so amounts are written as "Rs." rather than the rupee sign.
type Op = string;
const A4 = { w: 595.28, h: 841.89 };
const clean = (s: string) => String(s ?? '').normalize('NFKD').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/•/g, '*').replace(/₹/g, 'Rs.').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?').replace(/([\\()])/g, '\\$1');
// Helvetica average width per character at size 1 (good enough for right-aligning numbers and wrapping)
const W: Record<string, number> = { ' ': .278, '.': .278, ',': .278, '/': .278, '-': .333, '(': .333, ')': .333, ':': .278, i: .222, l: .222, j: .222, I: .278, f: .278, t: .278, r: .333 };
export const textWidth = (s: string, size: number, bold = false) =>
  [...String(s)].reduce((a, c) => a + (W[c] ?? (/[0-9]/.test(c) ? .556 : /[A-Z]/.test(c) ? .667 : /[mw]/.test(c) ? .833 : .556)), 0) * size * (bold ? 1.05 : 1);

export class Pdf {
  pages: Op[][] = [[]]; y = A4.h - 48; readonly left = 40; readonly right = A4.w - 40;
  private get ops() { return this.pages[this.pages.length - 1]; }
  newPage() { this.pages.push([]); this.y = A4.h - 48; }
  ensure(space: number) { if (this.y - space < 56) this.newPage(); }
  text(s: string, x: number, y: number, size = 9, bold = false, align: 'left' | 'right' | 'center' = 'left') {
    const tw = textWidth(s, size, bold);
    const px = align === 'right' ? x - tw : align === 'center' ? x - tw / 2 : x;
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${px.toFixed(2)} ${y.toFixed(2)} Td (${clean(s)}) Tj ET`);
  }
  line(x1: number, y1: number, x2: number, y2: number, w = 0.5) { this.ops.push(`${w} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`); }
  rect(x: number, y: number, w: number, h: number, fill?: string) {
    this.ops.push(fill ? `${fill} rg ${x} ${y} ${w} ${h} re f 0 g` : `0.5 w ${x} ${y} ${w} ${h} re S`);
  }
  wrap(s: string, width: number, size = 9, bold = false): string[] {
    const out: string[] = []; let cur = '';
    for (const word of String(s ?? '').split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (textWidth(next, size, bold) > width && cur) { out.push(cur); cur = word; } else cur = next;
    }
    if (cur) out.push(cur);
    return out.length ? out : [''];
  }
  para(s: string, x: number, width: number, size = 9, bold = false, lead = 1.3) {
    for (const l of this.wrap(s, width, size, bold)) { this.ensure(size * lead); this.text(l, x, this.y, size, bold); this.y -= size * lead; }
  }
  build(): Uint8Array {
    const objs: string[] = [];
    const add = (s: string) => { objs.push(s); return objs.length; };
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const pagesId = objs.length + 1; objs.push(''); // placeholder
    const kids: number[] = [];
    this.pages.forEach((ops, i) => {
      const footer = `BT /F1 7 Tf ${this.left} 28 Td (${clean(`Page ${i + 1} of ${this.pages.length}`)}) Tj ET`;
      const stream = [...ops, footer].join('\n');
      const c = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
    });
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'; const offs: number[] = [];
    objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new Uint8Array(Buffer.from(out, 'latin1'));
  }
}
