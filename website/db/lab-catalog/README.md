# Lab catalogue

Where people in the UAE can get blood tests, what each offering contains and what it costs. The end goal is to take the biomarkers a Namat doctor recommends and list where the patient can get all of them, with the total price.

Two schemas share one definition (`001_lab_catalog.sql`):

- `lab_catalog`: real providers.
- `lab_catalog_demo`: the fictional providers for the Hub71 demo (`demo.json`).

Both exist in the local `namat_hackathon` database and in Azure `namat_journey` (created 1 Oct 2026). The older `public.blood_test_offerings` table was left untouched.

## Tables

| Table | One row per | Holds |
|---|---|---|
| `providers` | brand | type, website, booking, licence, accreditation, who runs their samples, price-list contact |
| `collection_options` | provider × emirate × home/walk-in | fee rule and fee, free-collection threshold, minimum order, areas, turnaround |
| `branches` | walk-in site | address, area, emirate, hours |
| `offerings` | product, under the provider's own name | single test / panel / package, non-lab extras (consult, ECG), sample, fasting, turnaround, link |
| `offering_biomarkers` | item inside an offering | printed name, matched biomarker (or NULL), calculated, who matched and who verified it |
| `offering_prices` | offering × emirate × date checked | price, crossed-out list price, promo/list/contracted/indicative, VAT, source, valid until |
| `biomarkers` | biomarker | the clinical knowledge base's 81 markers, aliases, category, sample type, consent flag |
| `biomarker_groups` (+ members) | standard group | lipid panel, full blood count and the other knowledge-base bundles |

Views: `current_prices` (latest unexpired price per offering and emirate) and `catalogue` (one readable row per offering and price).

## Quotes (rules agreed 1 Oct 2026, built 2 Oct)

`scripts/lib/lab-quote.mjs` turns the biomarkers a doctor approved into options. `quoteFor(client, schema, {biomarkers, emirate, mode, area})` reads the catalogue; `quote(data, request)` is the same calculation on data already in memory.

- **One provider per option.** Orders are never split across providers.
- **Where.** The provider must collect in the patient's emirate. For home visits it must also cover the area, when it lists areas and one is given. Each visit type (home, walk-in) is its own option.
- **Exact cover.** The chosen offerings together contain every approved biomarker. A biomarker calculated from others counts when they are covered, and the option says so:
  - eGFR, calculated from creatinine (confirm the lab reports it);
  - non-HDL cholesterol, from total and HDL cholesterol.
- **Total.** The provider's lowest-total set of offerings plus one visit fee:
  - the fee is waived at or above `free_above_aed`;
  - an order below `minimum_order_aed` isn't offered;
  - an offering that could be dropped is never kept, so nothing is added just to reach free collection.
- **Packages** that include tests the doctor didn't order are allowed, labelled "+N not ordered". Items marked `calculated` don't count.
- **Sort (`sort-v1`):** options that cover every test, then listed total, then turnaround, then home collection, then provider. A "visit fee not stated" option sorts on its tests' total and is flagged. On screen, never say "cheapest" or "best price" (DoH advertising rules); say "Sorted by listed total, visit fees included".
- **No full cover.** If no provider covers the whole order, the ones that cover the most are listed, with what's missing named.
- **Approval.** Store the quote with the doctor's approval, so later price changes don't alter what the patient saw. Each result carries its rule versions.

Only matched items (`biomarker_id` not NULL) can satisfy an order. Automatic matches have `verified_by` NULL; a person should confirm them before real patients see the results.

## What the real catalogue keeps (agreed 2 Oct 2026)

`lab_catalog` holds only what can produce a quote for a doctor-approved plan. `prune` enforces this and `load` runs it at the end. Settings are in `prune.json`.

- **Prices.** Removed if they are expired, if they are a "from" or range price (`indicative`), or if they are for an emirate the provider doesn't collect in.
- **Offerings.** Removed if any of these apply:
  - no firm current price is left;
  - none of the 81 biomarkers is inside;
  - it is a panel or package for children or pregnancy (single tests stay);
  - it sits on an out-of-date page listed under `stale_offerings`, such as an older page set or a past seasonal offer.
- **Providers.** Removed if any of these apply:
  - nothing is left to quote;
  - it is listed under `excluded_providers` (Burjeel and Medeor: their prices were only in hidden page code);
  - in every emirate it collects in, it prices fewer than 12 of the 16 core biomarkers.

The 16 core biomarkers are the Hub71 registry: glucose, HbA1c, the lipid four, vitamin D, creatinine, eGFR, ferritin, B12, TSH, ALT, AST, hs-CRP and haemoglobin. A provider below the threshold can almost never cover a whole plan on its own, and options are always one provider.

The raw files keep everything. `load --no-prune` brings the full set back, for example to look for unmatched names with `unmapped`.

## Commands

```sh
node scripts/lab-catalog.mjs migrate --target=local          # or --target=azure
node scripts/lab-catalog.mjs seed-biomarkers --target=local
node scripts/lab-catalog.mjs seed-demo --target=local
node scripts/lab-catalog.mjs load --target=local --dir=../research/lab-catalog-2026-10-01/raw   # loads, then prunes
node scripts/lab-catalog.mjs prune --dry-run --target=local  # what prune would remove; changes nothing
node scripts/lab-catalog.mjs status --target=local
node scripts/lab-catalog.mjs unmapped --target=local --limit=40
node scripts/lab-catalog.mjs quote --target=local --emirate=abu_dhabi --tests=lipid,ferritin,vitamin-d-25-oh,vitamin-b12
node scripts/lab-catalog.mjs quote --target=local --emirate=dubai --tests=core --mode=home --json   # core = the 16 core biomarkers
LAB_CATALOG_TEST_DATABASE_URL=postgres://…@127.0.0.1:…/db node --test tests/lab-catalog.test.mjs tests/lab-quote.test.mjs
```

`quote --demo` reads the fictional providers instead.

`local` reads `HACKATHON_DATABASE_URL` from `.env.hackathon.local` and accepts only a loopback host. `azure` reads the `JOURNEY_DATABASE_*` admin settings from `.env`. Neither prints connection details. The app runtime logins have no access to these schemas yet; grant `USAGE` and `SELECT` only when an app needs to read them.

## Example: the demo's four-test order in Abu Dhabi

`quote --demo --emirate=abu_dhabi --tests=lipid,ferritin,vitamin-d-25-oh,vitamin-b12` gives:

| Option | Listed total | Why |
|---|---|---|
| Walk-in lab B, walk-in | AED 390 | 110 + 70 + 120 + 90, no visit fee |
| Home visit A, home visit | AED 399 | One package covers all four, +6 not ordered. Its four single tests would cost 606. |

Clinic C isn't listed because it doesn't sell B12, and Provider D doesn't collect in Abu Dhabi. Run the same order without `--demo` and it lists the real providers: 17 options from 12 providers, starting at AED 268 before a visit fee.

## Adding data

- Collected provider files live outside this repository, in the project's research folder (`../research/lab-catalog-2026-10-01/raw/`, the default `--dir`). A file is the provider's whole current catalogue. `load`:
  - replaces the provider's collection options, branches and offering contents;
  - removes offerings the file no longer lists;
  - replaces prices for the file's date and keeps earlier dates as history.
- `_discovery*.json` files list providers found by a sweep, for contacting them. They are not loaded: a provider without collected offerings can't be quoted.
- A collection option without an emirate is recorded for all seven only when its quote claims UAE-wide service ("anywhere in the UAE"); otherwise it is skipped.
- Printed names match biomarkers exactly after normalising case, punctuation, word order and spelling.
  - "Name (Synonym)" and slash lists ("AST/SGOT") match when every part names the same biomarker.
  - A bare "CBC" or "Lipid Profile" expands to its core results (`standard-panel-v1`, an assumption).
  - "Panel (A, B, C)" uses its listed parts.
  - A line naming several tests ("Vitamin D & B12", "SGOT (AST) and SGPT (ALT)", "PT/INR", "Diabetic Screen (Glucose, HbA1c)") is split only when every part is a known name on its own. "Testosterone, Free" and "LDL/HDL ratio" stay unmatched.
  - Add unambiguous printed names to `aliases.json`. Never add qualified names (free, direct, ionised, urine, 1,25-dihydroxy) to a different biomarker.
- `biomarkers.json` is generated from the clinical knowledge base (`namat-clinical-kb-v0.2.json`, DRAFT until the CMO approves it).
- Unilabs and DarDoc only show prices in a browser; they were read in the in-app browser (approved 1 Oct 2026). Prices hidden behind "View price" forms are not collected; Burjeel and Medeor from round 1 are the exceptions, flagged internal-only.
