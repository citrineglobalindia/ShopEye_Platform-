// SRS: CUST-FR-150 (customer-safe errors, no internal detail)
// Map database rule codes to plain customer-facing messages (CUST §30, SRS: no internal detail leaks)
const MAP: [RegExp, string][] = [
  [/INSUFFICIENT_STOCK/, 'One of the items just sold out. Remove it or lower the quantity to continue.'],
  [/ITEM_UNAVAILABLE/, 'An item in your cart is no longer available. Remove it to continue.'],
  [/QTY_LIMIT_EXCEEDED/, 'You have more of an item than one order allows. Lower the quantity.'],
  [/NOT_SERVICEABLE/, 'We don\u2019t deliver to this pincode yet. Try another address.'],
  [/COD_NOT_AVAILABLE/, 'Cash on delivery isn\u2019t available for this pincode. Choose online payment.'],
  [/COUPON_INVALID/, 'This coupon has expired or doesn\u2019t exist.'],
  [/COUPON_MIN_NOT_MET: minimum ([\d.]+)/, 'Add more items to use this coupon.'],
  [/COUPON_USAGE_LIMIT/, 'You\u2019ve already used this coupon.'],
  [/COUPON_EXHAUSTED/, 'This coupon has been fully claimed.'],
  [/CART_EMPTY/, 'Your cart is empty.'],
  [/ADDRESS_NOT_FOUND/, 'Choose a delivery address.'],
  [/NOT_CANCELLABLE/, 'This item has already shipped and can\u2019t be cancelled. You can return it after delivery.'],
  [/RETURN_WINDOW_CLOSED/, 'The return window for this item has closed.'],
  [/EVIDENCE_REQUIRED/, 'Add a photo for damaged, defective or wrong items.'],
  [/RETURN_QTY_EXCEEDS_DELIVERED/, 'You’ve already returned or cancelled that many of this item.'],
  [/NOT_RETURNABLE/, 'This item can’t be returned.'],
  [/RETURN_NOT_CANCELLABLE/, 'This return has already been picked up, so it can’t be cancelled now.'],
  [/RATE_LIMITED/, 'You’ve sent several requests just now. Please wait a little and try again.'],
  [/REASON_REQUIRED/, 'Add a reason of at least a few words.'],
  [/INVALID_TRANSITION/, 'That step isn\u2019t allowed from the current status.'],
  [/CARRIER_AND_AWB_REQUIRED/, 'Enter the courier name and AWB number.'],
  [/EMAIL_REQUIRED/, 'Add an email address to your account first.'],
  [/INVALID_PINCODE/, 'Enter a valid 6-digit pincode.'],
  [/FORBIDDEN|permission denied|42501/, 'You don\u2019t have access to do that.'],
  [/AUTH_REQUIRED|JWT/, 'Please sign in to continue.'],
  [/duplicate key.*sku/, 'That SKU is already used in your catalogue.'],
  [/check constraint.*product_variants/, 'Selling price must be above zero and not more than MRP.'],
];
export function friendly(e: any): string {
  const msg = String(e?.message || e || '');
  for (const [re, text] of MAP) if (re.test(msg)) return text;
  return 'Something went wrong. Please try again.';
}
