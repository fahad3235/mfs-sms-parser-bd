# MFS SMS Parser BD

![status](https://img.shields.io/badge/status-MVP-green) ![tests](https://img.shields.io/badge/tests-130%2F130-brightgreen) ![offline](https://img.shields.io/badge/offline-100%25-blue)

Paste Bangladeshi mobile-banking SMS (bKash, Nagad, Rocket, Upay) and get a clean,
sortable transaction ledger with duplicate detection, contact-name mapping and
one-click CSV export. **100% client-side -- your SMS never leave the browser.**

## The problem

MFS transaction SMS pile up in the inbox as unstructured text. Reconciling them
into a spreadsheet means retyping every amount, TrxID and date by hand -- slow
and error-prone.

## Features

1. **Bulk SMS parsing** -- paste one or many SMS (blank-line separated); provider
   auto-detection for bKash / Nagad / Rocket / Upay with manual override.
2. **Field extraction** -- amount, fee/charge, balance-after, TrxID, date, time and
   counterparty (mobile number or merchant name) via documented heuristics.
3. **Validation checks** -- duplicate TrxIDs flagged in the table; lines the parser
   cannot confidently read land in a **Needs review** bucket instead of being
   silently dropped; missing-TrxID and unknown-provider warnings per row.
4. **Summary dashboard** -- parsed count, money in/out totals, duplicate count,
   review count, plus per-provider in/out breakdown.
5. **Sortable / filterable / searchable ledger** -- sort by date, provider, type,
   amount, counterparty or balance; filter by provider and transaction type;
   free-text search across TrxID, numbers and mapped names.
6. **Contact-name mapping** -- paste `01XXXXXXXXX,Name` lines once; numbers show
   with names everywhere (table + CSV). Stored in localStorage.
7. **Excel-ready CSV export** -- UTF-8 BOM, proper quoting, one click. Plus
   copy-as-TSV and a typed-`CLEAR` erase that wipes everything.
8. **Bilingual UI** -- English / Bangla toggle (persisted), Bangla digits in
   Bangla mode, responsive down to 390px.

## Stack

Vanilla HTML + CSS + JavaScript. No frameworks, no build step, no network calls.

```
index.html        page shell (data-i18n hooks)
css/style.css     dark-slate + emerald theme, mobile-first
js/parser.js      pure parsing functions (UMD: browser + node)
js/i18n.js        EN/BN string tables (Bengali as \uXXXX escapes)
js/app.js         UI wiring, rendering, export, persistence
tests/unit.cjs    64 node assertions on the parser
tests/smoke.js    33 headless-Chrome checks x2 viewports (raw CDP, no deps)
```

## Prerequisites

Any modern browser (Chrome, Edge, Firefox, Safari). Node.js 18+ only if you want
to run the test suites.

## Install & run

```bash
# just open it -- no install, no server needed
open index.html        # macOS
xdg-open index.html    # Linux
```

Or serve statically for a shareable preview:

```bash
npx serve .            # then open the printed URL
```

## Dev commands

```bash
node tests/unit.cjs                 # parser unit tests (64 assertions)
node tests/smoke.js --viewport=desktop   # Chrome smoke, 1280px
node tests/smoke.js --viewport=mobile    # Chrome smoke, 390px
```

## Environment

None. There are no API keys, no backend and no configuration. The app stores
only two preferences in `localStorage` (`mfs-sms-parser-bd-v1`): UI language and
your name mapping. Parsed SMS are kept in memory only and vanish on reload --
deliberately, for privacy.

## Testing

- `tests/unit.cjs`: **64/64 pass** -- provider/type detection, money/TrxID/
  counterparty/date extraction, batch splitting, duplicate marking, summary math,
  contact mapping, CSV (BOM, header, quoting, mapped names).
- `tests/smoke.js`: **33/33 desktop + 33/33 mobile pass, 0 console/page errors** --
  boot, empty states, sample load (6 parsed / 1 review / 2 duplicates), summary
  math (in 8,500.00 / out 4,050.00 BDT), provider filter, search, amount sort,
  name mapping, CSV content, BN toggle + persistence, typed-CLEAR erase,
  390px no-overflow.

## Deployment

Static site -- drop the folder on GitHub Pages, Netlify, Cloudflare Pages or any
static host. No build step required.

## Limitations (honest)

- The parser is **heuristic, not exact**: it recognises common field shapes
  (`Tk 1,200.00`, `TrxID ...`, `01XXXXXXXXX`, `DD/MM/YYYY`). Providers change SMS
  wording; anything unrecognised goes to **Needs review** rather than being
  guessed.
- Messages must be separated by a **blank line** when pasting several at once.
- No OCR and no inbox access -- you paste the SMS text yourself.
- Summary "in/out" follows transaction type (Cash In = in, Send Money = out);
  verify against your provider statement for final accounts.
- Not affiliated with bKash, Nagad, Rocket or Upay.

## Status

MVP v1.0.0 -- built, tested and published by the MUSE Project Factory
(run #101, 2026-10-21 12:00 slot).
