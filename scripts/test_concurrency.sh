#!/usr/bin/env bash
# 10 shoppers race for the LAST unit of KRT-L at the same instant.
# Expect exactly one order, nine INSUFFICIENT_STOCK, and no negative stock (SM §35, CUST edge case "last unit sold").
set -euo pipefail
URL=${URL:-postgresql://claude:x@localhost}; DB=${DB:-shopeye}; N=10
psql "$URL/$DB" -q -v ON_ERROR_STOP=1 <<SQL >/dev/null
do \$\$ declare i int; u uuid; begin
  for i in 1..$N loop
    u := ('00000000-0000-0000-0000-0000000009' || lpad(i::text, 2, '0'))::uuid;
    insert into auth.users(id) values (u);
    insert into public.profiles(id, full_name, mobile) values (u, 'Racer ' || i, '+91980000' || lpad(i::text, 4, '0'));
    insert into public.customer_addresses(customer_id, recipient, mobile, line1, line2, city, state_code, pincode, address_type)
      values (u, 'Racer ' || i, '+919800000000', '1 Main Rd', 'Indiranagar', 'Bengaluru', 'KA', '560034', 'home');
    perform test.cart(u, '[{"v":"kurta_l","q":1}]');
  end loop;
end \$\$;
SQL
rm -f /tmp/race_*.log
for i in $(seq -w 1 $N); do
  ( psql "$URL/$DB" -qtA -v ON_ERROR_STOP=1 >/tmp/race_$i.log 2>&1 <<SQL
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000009$i', false);
select public.place_order((select id from carts where customer_id = '00000000-0000-0000-0000-0000000009$i' and status='active'),
                          (select id from customer_addresses where customer_id = '00000000-0000-0000-0000-0000000009$i'),
                          'upi', 'race-$i', null);
SQL
  ) &
done
wait
OK=$(grep -l '"replay": false' /tmp/race_*.log | wc -l)
OOS=$(grep -l 'INSUFFICIENT_STOCK' /tmp/race_*.log | wc -l)
read ONHAND RESERVED AVAIL < <(psql "$URL/$DB" -qtA -F' ' -c "select on_hand, reserved, available from stock_balances where variant_id='00000000-0000-0000-0000-000000000402'")
echo "== 12. Concurrency: $N simultaneous checkouts for the last unit"
echo "orders created=$OK  rejected INSUFFICIENT_STOCK=$OOS  on_hand=$ONHAND reserved=$RESERVED available=$AVAIL"
if [[ $OK -eq 1 && $OOS -eq $((N-1)) && $AVAIL -eq 0 && $RESERVED -eq 1 ]]; then
  echo "PASS  Exactly one winner, no oversell under race"
else
  echo "FAIL  concurrency"; cat /tmp/race_*.log; exit 1
fi
