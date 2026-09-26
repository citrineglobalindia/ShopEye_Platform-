#!/usr/bin/env python3
"""Build docs/traceability-matrix.csv from the six Shopeye SRS PDFs (text-extracted).
Maps every requirement ID to portal, SRS section, delivery phase and Phase-0 status."""
import re, csv, sys, pathlib, collections
RAW = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/home/claude/srs/raw')
ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = [  # (file stem, prefix regex, portal)
  ('Shopeye_Customer_Website_SRS_v1_0', r'CUST-FR-\d{3}', 'Customer Website'),
  ('Shopeye_Vendor_and_Vendor_Staff_SRS_v1_0', r'VS-FR-\d{3,4}', 'Vendor & Vendor Staff'),
  ('Shopeye_Super_Admin_SRS_v3_0', r'SA-FR-\d{3}', 'Super Admin'),
  ('Shopeye_Accounts_SRS_v1_0', r'AF-FR-\d{4}', 'Accounts & Finance'),
  ('Shopeye_Stock_Manager_SRS_v1_0', r'SM-FR-\d{4}', 'Stock Manager'),
  ('Shopeye_QC_Vendor_Manager_Help_Desk_Web_Fully_Traceable_SRS_v1_0', r'OPS-FR-\d{4}', 'QC / Vendor Manager / Help Desk'),
]
SECTION = re.compile(r'^\s*(\d{1,2})\.\s+([A-Z][A-Za-z0-9&/,()’\'\- –]{3,90})\s*$')
PHASES = [  # first match wins; section-title keywords
  ('P0 Foundation', r'authentication|login|mfa|session|roles|permission|audit|approval matrix|maker|non-functional|security|status model|validation|error handling|concurrency|configuration|number series|document purpose|conventions|retention|privacy'),
  ('P3 Finance', r'ledger|settlement|payout|commission|reconciliation|journal|period close|gst|tds|tcs|tax|expense|bank|chargeback|finance|accounting|credit note|invoice|fee|cod collection|promotional discount accounting|logistics, rto'),
  ('P2 Fulfilment & Ops', r'stock|warehouse|inbound|asn|receiving|grn|putaway|bin|replenish|cycle count|reservation|pick|pack|dispatch|return|rto|damaged|quarantine|batch|serial|barcode|low stock|inventory|qc|inspection|defect|help desk|ticket|callback|omnichannel|knowledge|escalation|sla|complaint|dispute|cancellation|refund|shipping|shipment|courier|logistics|tracking|delivery'),
  ('P4 Growth & Control', r'vendor manager|portfolio|training|meeting|report|analytics|review|rating|question|wishlist|recently|compare|coupon|promotion|loyalty|gift|referral|recommend|merchandising|banner|notification template|bulk|import|export|integration|webhook|api key|subscription|plan|seo|discover'),
  ('P1 Marketplace MVP', r'.*'),
]
def phase_for(section):
    s = section.lower()
    for name, rx in PHASES:
        if re.search(rx, s): return name
def expand_refs(text):
    ids = set(re.findall(r'(?:CUST|VS|SA|AF|SM|OPS)-FR-\d+', text))
    for pre, a, b in re.findall(r'((?:CUST|VS|SA|AF|SM|OPS)-FR-)(\d+)\s*\.\.\s*(\d+)', text):
        w = len(a)
        ids.update(f'{pre}{str(i).zfill(w)}' for i in range(int(a), int(b) + 1))
    return ids
code_refs = set(); test_refs = set()
for f in (ROOT / 'supabase/migrations').glob('*.sql'): code_refs |= expand_refs(f.read_text())
for f in (ROOT / 'supabase/tests').glob('*.sql'):     test_refs |= expand_refs(f.read_text())
rows = []; counts = collections.Counter()
for stem, pat, portal in DOCS:
    text = (RAW / f'{stem}.txt').read_text(errors='ignore')
    text = re.sub(r'((?:CUST|VS|SA|AF|SM|OPS)-FR)-?\s*(\d{3,4})\b', r'\1-\2', text)   # IDs wrapped/split in PDF text
    rid = re.compile(pat); section = ''; seen = set()
    lines = text.splitlines()
    for i, line in enumerate(lines):
        m = SECTION.match(line)
        if m and not rid.search(line) and 'Summary' not in line: section = f'{m.group(1)}. {m.group(2).strip()}'
        for mm in rid.finditer(line):
            r = mm.group(0)
            if r in seen: continue
            seen.add(r)
            tail = (line[mm.end():] + ' ' + ' '.join(lines[i+1:i+7]))
            tail = rid.split(tail)[0]
            tail = re.sub(r'Shopeye.*?Page \d+|SHOPEYE \|[^\n]*|\s+', ' ', tail).strip(' |:-')
            ph = phase_for(section)
            status = 'DB rule test-verified' if r in test_refs else 'DB foundation in place' if r in code_refs else 'Not started'
            rows.append([r, portal, section, tail[:220], ph, status]); counts[(portal, status)] += 1
rows.sort(key=lambda x: (x[1], int(re.search(r'\d+$', x[0]).group())))
out = ROOT / 'docs/traceability-matrix.csv'
with out.open('w', newline='') as fh:
    w = csv.writer(fh); w.writerow(['Requirement ID','Portal','SRS Section','Requirement (extract)','Delivery Phase','Status']); w.writerows(rows)
print(f'{len(rows)} requirements -> {out}')
by = collections.Counter((r[1], r[4]) for r in rows)
for portal in dict.fromkeys(r[1] for r in rows):
    print(f'{portal:32s}', ' '.join(f"{p.split()[0]}={by[(portal,p)]}" for p,_ in PHASES),
          f"| verified={counts[(portal,'DB rule test-verified')]} enforced={counts[(portal,'DB foundation in place')]}")
