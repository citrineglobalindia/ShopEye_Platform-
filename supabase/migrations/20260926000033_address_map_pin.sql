-- SHOPEYE 0033 — Optional map pin on delivery addresses. The pin only supplements the typed address: the
-- customer confirms any address details suggested from the pin, and the pin travels with the order snapshot
-- so the courier can find the door. Traces: CUST-FR-068
alter table public.customer_addresses
  add column if not exists latitude  numeric(9,6) check (latitude  is null or latitude  between 6 and 37.5),
  add column if not exists longitude numeric(9,6) check (longitude is null or longitude between 68 and 97.5),
  add column if not exists pin_source text check (pin_source is null or pin_source in ('map','gps'));
alter table public.customer_addresses drop constraint if exists customer_addresses_pin_pair;
alter table public.customer_addresses add constraint customer_addresses_pin_pair
  check ((latitude is null) = (longitude is null) and (latitude is null or pin_source is not null));
