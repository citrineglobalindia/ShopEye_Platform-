// Customer-facing policy and help content (CUST §29). Draft wording: review with your legal/business owner before launch.
export type Info = { title: string; intro: string; sections: [string, string][] };
export const INFO: Record<string, Info> = {
  about: { title: 'About ShopEye', intro: 'ShopEye is a marketplace for independent Indian sellers: weavers, makers and small brands.', sections: [
    ['How it works', 'Sellers apply, we check their business details, and every product they list is reviewed before it goes live. You buy from the seller; ShopEye handles payment, tracking and support.'],
    ['Why “checked before it reaches you”', 'Listings are reviewed for accurate photos, prices and descriptions. If something isn’t right when it arrives, our returns process covers you.']] },
  contact: { title: 'Contact us', intro: 'We’re here to help with orders, payments, returns and refunds.', sections: [
    ['About an order', 'Open the order from My orders. The fastest help comes from there, because we can see the order details straight away.'],
    ['Email', 'Write to support@shopeye.in with your order number. We reply within one working day.'],
    ['Sellers', 'For selling on ShopEye, use the Seller hub or write to sellers@shopeye.in.']] },
  help: { title: 'Help centre', intro: 'Answers to the questions shoppers ask most.', sections: [
    ['Where is my order?', 'Go to My orders and open the order. Each package shows its courier and tracking number once it ships.'],
    ['Why did my order arrive in separate packages?', 'Items from different sellers ship separately. Each package has its own tracking.'],
    ['I paid but the order says awaiting payment', 'Don’t pay again. Bank confirmations can take a few minutes; the order updates automatically. If money was taken and the order isn’t confirmed within 24 hours, it is refunded in full.'],
    ['How do I cancel?', 'Open the order and choose Cancel item. You can cancel until the seller hands the package to the courier.'],
    ['How long do refunds take?', 'We start the refund as soon as the cancellation or return is approved. Banks usually credit it within 5–7 working days.'],
    ['Is cash on delivery available?', 'Enter your pincode on any product page to see whether cash on delivery is available where you are.']] },
  'shipping-policy': { title: 'Shipping policy', intro: 'How and when your order is delivered.', sections: [
    ['Delivery areas', 'Check your pincode on any product page before ordering. Checkout confirms delivery to your address before you pay.'],
    ['Delivery times', 'Most orders arrive in 3–7 days. The product page shows an estimate for your pincode.'],
    ['Shipping charges', 'Each seller’s package ships free above ₹499. Below that, a ₹49 shipping charge applies per seller package, shown before you pay.'],
    ['Split shipments', 'Items from different sellers ship as separate packages, each with its own tracking.']] },
  'returns-policy': { title: 'Returns and refunds', intro: 'Every product page shows its return window before you buy.', sections: [
    ['Return window', 'Most products can be returned within 7 days of delivery. Some categories have a different window, and some items can’t be returned; the product page always says which.'],
    ['Condition', 'Items should be unused, with original tags and packaging. For damaged, defective or wrong items, add a photo when you request the return.'],
    ['Refunds', 'Refunds go back to your original payment method once the returned item passes its quality check. Cash-on-delivery orders are refunded to your bank account.']] },
  'cancellation-policy': { title: 'Cancellation policy', intro: 'You can cancel any item before it ships.', sections: [
    ['Before shipping', 'Open the order and choose Cancel item. You can cancel part of an order; the rest continues as normal.'],
    ['After shipping', 'Once an item is with the courier it can’t be cancelled. You can return it after delivery if it’s returnable.'],
    ['Refund for cancellations', 'If you paid online, the refund for the cancelled item starts immediately, including its share of any coupon discount.']] },
  privacy: { title: 'Privacy policy', intro: 'How ShopEye collects and uses your information.', sections: [
    ['What we collect', 'Your name, email, phone number and delivery addresses; your orders; and payment status from Razorpay. We never see or store your card details.'],
    ['How we use it', 'To deliver your orders, process payments and refunds, provide support and keep your account secure. We share delivery details only with the seller and courier handling your package.'],
    ['Your choices', 'You can update your details in My account. Marketing messages are only sent if you opt in.'],
    ['Signing in with Google or Facebook', 'If you choose to, we receive only your name and email address from Google or Facebook, to create and sign in to your account. We never post to your accounts or see your contacts.'],
    ['Your delivery location', 'To show delivery dates, the site estimates your city and pincode from your network address using BigDataCloud’s free lookup, and only uses your exact location (turned into a pincode by BigDataCloud or OpenStreetMap) if you tap “Use my current location” and allow it. The pincode is kept on your device, not in your account, unless you save an address.'],
    ['Deleting your data', 'See Delete your data (www.shopeye.in/data-deletion) for how to ask us to delete your account.']] },
  'data-deletion': { title: 'Delete your data', intro: 'How to ask ShopEye to delete your account and personal data, including data received from Google or Facebook sign-in.', sections: [
    ['What you can do yourself', 'Sign in and open My account. You can download a copy of your data, change your details, remove saved addresses and turn off marketing messages at any time.'],
    ['Ask us to delete your account', 'Write to support@shopeye.in from the email address on your account, or raise a request from Help → Contact us with the subject “Delete my account”. We confirm it’s you, then delete your account and personal data within 30 days.'],
    ['What we have to keep', 'Indian tax law requires us to keep invoices and order records for 8 years. These are kept securely, used only for tax and legal purposes, and removed when the period ends.'],
    ['Google or Facebook sign-in', 'Deleting your ShopEye account also removes the name and email we received from Google or Facebook. You can also disconnect ShopEye in your Google or Facebook account settings; this stops future sign-ins but doesn’t delete your ShopEye data by itself.']] },
  terms: { title: 'Terms of use', intro: 'The terms that apply when you use ShopEye.', sections: [
    ['Who you buy from', 'Products are sold by independent sellers. ShopEye provides the marketplace, payment and support.'],
    ['Prices', 'Prices include GST. The price is confirmed when you place the order; if it changed since you added the item, checkout shows the new price before you pay.'],
    ['Your account', 'Keep your sign-in email secure. You’re responsible for orders placed from your account.']] },
};
