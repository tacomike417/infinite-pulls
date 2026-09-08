#!/bin/bash
run(){ psql -h /tmp/pgsock -p 5433 -d postgres -tA -F'|' -c "select score, matched_on, set_id, collector_number, coalesce(card_name,name_native) from public.search_cards(\$q\$$2\$q\$, '$3') limit 3;"; }
while IFS='|' read -r id q lang; do
  echo "### $id  query=[$q] lang=$lang"
  out=$(run "$id" "$q" "$lang")
  if [ -z "$out" ]; then echo "   (NO RESULTS)"; else echo "$out" | sed 's/^/   /'; fi
done <<'CASES'
T001|SVP EN 051|en
T002|SVP051|en
T003|SVP 51|en
T004|051|en
T005|150/202|en
T006|150|en
T007|TG05|en
T008|TG 05|en
T009|GG05|en
T010|RC1|en
T011|SH1|en
T012|SL1|en
T013|BW004|en
T014|SWSH144|en
T015|2a|en
T016|A|en
T017|?|en
T018|ONE|en
T019|001/SV-P|ja
T020|Charizard 4/102|en
T021|Charizard 4|en
T022|Pokemon Center stamped card|en
T023|reverse holo 25|en
T024|PSA 10 SVP 051|en
T025|booster box SVP|en
TX01|black star promo snorlax|en
TX02|s&v promo 51|en
TX03|snorlax|en
TX04|charizard|en
CASES

# HOW TO RUN THIS
#
# It expects a psql on /tmp/pgsock:5433 holding a copy of public.cards with
# card_search.sql installed. It prints the top three results for every one
# of the 25 acceptance cases in the identifier pack, plus four of my own.
# It does not assert -- it shows, because the thing being tested is
# RANKING, and a number in a column is not a substitute for looking at
# which card came first.
