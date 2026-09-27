// Public values only. The publishable key is designed to ship to browsers;
// row-level security in the database is what protects data.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://byaaaesufrneivzcsxtv.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_-GiPqAuUN_VLrhwVvR0yoA_fdKxndHQ';
export const inr = (n: number | string) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(n));
export const STATES: [string, string][] = [
  ['AN','Andaman & Nicobar'],['AP','Andhra Pradesh'],['AR','Arunachal Pradesh'],['AS','Assam'],['BR','Bihar'],['CH','Chandigarh'],
  ['CT','Chhattisgarh'],['DN','Dadra & Nagar Haveli and Daman & Diu'],['DL','Delhi'],['GA','Goa'],['GJ','Gujarat'],['HR','Haryana'],
  ['HP','Himachal Pradesh'],['JK','Jammu & Kashmir'],['JH','Jharkhand'],['KA','Karnataka'],['KL','Kerala'],['LA','Ladakh'],
  ['LD','Lakshadweep'],['MP','Madhya Pradesh'],['MH','Maharashtra'],['MN','Manipur'],['ML','Meghalaya'],['MZ','Mizoram'],
  ['NL','Nagaland'],['OR','Odisha'],['PY','Puducherry'],['PB','Punjab'],['RJ','Rajasthan'],['SK','Sikkim'],['TN','Tamil Nadu'],
  ['TG','Telangana'],['TR','Tripura'],['UP','Uttar Pradesh'],['UT','Uttarakhand'],['WB','West Bengal'],
];
// Mirrors app.settings shipping.flat_fee_per_vendor / free_threshold_per_vendor (the server recalculates at order time)
export const SHIP_FLAT = 49, SHIP_FREE_AT = 499;
export type ShipRules = { flat: number; free: number; live: boolean };
export const SHIP_DEFAULT: ShipRules = { flat: SHIP_FLAT, free: SHIP_FREE_AT, live: false };
export const shipFor = (packageTotal: number, r: ShipRules = SHIP_DEFAULT) => (packageTotal >= r.free ? 0 : r.flat);

// SRS: CUST-FR-149 (session cookies are Secure on the live site and SameSite=Lax, so they never travel over plain HTTP or with cross-site form posts)
export const AUTH_COOKIE = { secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
