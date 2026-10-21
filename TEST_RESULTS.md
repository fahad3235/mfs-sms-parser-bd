# TEST_RESULTS -- mfs-sms-parser-bd (factory run #101, 2026-10-21 12:00 slot)

## Unit tests (`node tests/unit.cjs`) -- 64/64 pass

Hand-verified parser behaviour:
- provider detection: bKash / Nagad / Rocket(via DBBL) / Upay / unknown
- type detection: cash_in, cash_out, send_money, payment, recharge, receive_money, other
- money: `Tk 5,000.00` + `Fee Tk 0.00` + `Balance Tk 5,120.50` split correctly;
  `Charge Tk 36.50` (Nagad wording) treated as fee; thousands separators stripped
- TrxID: `TrxID 9HXK2LM4PQ`, `Trx ID: abc123x` -> uppercased `ABC123X`; absent -> null
- counterparty: `from 01800000001`, `to 01900000002`, `to Agent 01700000003`,
  merchant `to Shwapno Mirpur`; absent -> null
- datetime: `on 20/10/2026 at 14:32` -> `2026-10-20` / `14:32`
- full-message parse: bKash cash-in extracts all 9 fields; OTP line -> parsed=false + `unparseable`
- warnings: missing TrxID flagged; provider override (`nagad`) honoured
- batch: blank-line + CRLF splitting; empty chunks dropped
- duplicates: same TrxID (case-insensitive) flags both rows; distinct TrxID clean
- summary: in 8000 / out 1200 over 3 parsed + 1 review; per-provider counts correct
- contacts: `01800000001,Amma` maps; malformed lines skipped; display `Amma (01800000001)`
- CSV: BOM present (U+FEFF), header exact, review rows excluded, mapped names included,
  comma/quote in merchant name quoted correctly

Repairs: 2 real parser bugs found while writing tests (fixed before first full run):
1. `extractMoney` only matched `Fee`, not Nagad's `Charge` -- generalized to `(?:fee|charge)`.
2. `extractCounterparty` required `from ` immediately before the number, missing
   `to Agent 017...` shapes -- generalized to `from|to` + loose intervening text.

## Headless-Chrome smoke (`node tests/smoke.js`) -- 33/33 desktop + 33/33 mobile, 0 console/page errors

Raw CDP against /opt/meta-chromium/chrome, file:// load:
1. app boots (`window.__mfs` present, DOM complete), hook version 1.0.0
2. default UI English (`MFS SMS Parser BD`)
3. empty states: stats 0, table empty-state, review hidden, 0 rows
4. sample load -> 6 parsed / 1 review / 2 duplicates / banner shown
5. summary math: in `8,500.00`, out `4,050.00` BDT
6. review box lists the OTP line (`482910`)
7. per-provider table: 4 rows
8. provider filter `nagad` -> 1 row; reset -> 6 rows
9. search `9HXK2LM4PQ` -> duplicate pair (2 rows)
10. amount sort asc -> `500.00` first
11. contacts `01800000001,Amma` -> table shows `Amma (01800000001)`
12. CSV via `buildCSV`: BOM + 7 lines (header + 6) + mapped name present
13. BN toggle: title becomes Bengali, summary uses Bengali digits
14. BN UI persists across reload; toggled back to EN
15. erase: box opens; `nope` -> toast + rows intact; `CLEAR` -> 0 rows, empty state + stats reset
16. no horizontal overflow at 1280px and 390px
17. zero console/page errors across the whole session

Source hygiene: all pushed sources pure ASCII (Bengali as \uXXXX escapes in JS,
numeric entities in HTML) -- verified with `grep -P '[^\x00-\x7F]'` = zero matches.
