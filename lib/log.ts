// SRS: CUST-FR-174 CUST-FR-023 (server logs never carry OTPs, tokens, signatures, card data, emails or phone numbers)
const RULES: [RegExp, string][] = [
  [/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]'],                                   // access / refresh tokens
  [/\b(sk|rzp)_(live|test)_[A-Za-z0-9]+/gi, '[key]'],                          // API keys
  [/\b(sb_secret|sb_publishable)_[\w-]+/gi, '[key]'],
  [/\b[0-9a-f]{40,}\b/gi, '[hash]'],                                         // signatures, token hashes, doc keys
  [/\b(?:\d[ -]?){13,19}\b/g, '[card]'],                                      // card-like digit runs
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/(\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g, '[phone]'],
  [/\b\d{6,8}\b/g, '[code]'],                                                 // OTPs
  [/(password|secret|otp|token|signature|cvv|pin)(["'\s:=]+)[^\s,"'}]+/gi, '$1$2[redacted]'],
];
export function redact(v: unknown): string {
  let s = typeof v === 'string' ? v : v instanceof Error ? v.message : (() => { try { return JSON.stringify(v); } catch { return String(v); } })();
  for (const [re, to] of RULES) s = s.replace(re, to);
  return s.slice(0, 500);
}
// Order/refund ids are UUIDs and safe to keep; everything else goes through redact()
export function logError(where: string, ...parts: unknown[]) { console.error(where, ...parts.map((p) => /^[0-9a-f-]{36}$/i.test(String(p)) ? p : redact(p))); }
