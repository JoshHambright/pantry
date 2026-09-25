# Pantry — Build Tracker

The live source of truth for progress. Update it in the same commit as the work
it describes — this file is the handoff mechanism, not documentation.

Last updated: 2026-09-22

## Status key

| Symbol | Meaning                        |
| :----: | ------------------------------ |
|   ⬜   | Not started                    |
|   🟨   | In progress                    |
|   ✅   | Done, tested, passing in CI    |
|   ⛔   | Blocked (blocker noted inline) |
|   ❌   | Cut (reason noted inline)      |

**Rules**

1. A task is ✅ only when its tests pass in CI, not when the code works locally.
2. Anything that produced a non-obvious choice gets a `DECISIONS.md` entry.
3. Cut scope is marked ❌ with a reason, never deleted.

---

## Progress

| Phase | Title               | Tasks | Done | Status      |
| ----- | ------------------- | :---: | :--: | ----------- |
| 0     | Foundation          |   6   |  6   | ✅ Complete |
| 1     | Core inventory      |   9   |  9   | ✅ Complete |
| 2     | Scanning            |   7   |  7   | ✅ Complete |
| 3     | Shopping & requests |   6   |  6   | ✅ Complete |
| 4     | Meals               |   6   |  6   | ✅ Complete |
| 5     | Web app             |   8   |  8   | ✅ Complete |
| 6     | Deployment          |   5   |  5   | ✅ Complete |
| 7     | Living with it      |   9   |  0   | ⬜ Next     |

**107 tests passing.** The loop in `PRODUCT.md` closes end to end.

---

## Phase 0 · Foundation

| ID    | Task                                                                 | Status |
| ----- | -------------------------------------------------------------------- | :----: |
| P0-01 | pnpm workspace, TypeScript project references, strict config         |   ✅   |
| P0-02 | ESLint, Prettier, Vitest                                             |   ✅   |
| P0-03 | `@pantry/shared`: unit table and conversion groups                   |   ✅   |
| P0-04 | Free-text quantity parsing (`2 lbs`, `1 1/2 cups`, `½ gal`)          |   ✅   |
| P0-05 | Inventory maths: totals, use-order, consumption plans, par shortfall |   ✅   |
| P0-06 | zod request schemas and shared response types                        |   ✅   |

## Phase 1 · Core inventory

| ID    | Task                                               | Status |
| ----- | -------------------------------------------------- | :----: |
| P1-01 | Postgres schema, 14 tables, Drizzle migrations     |   ✅   |
| P1-02 | Env validation that fails loudly at boot           |   ✅   |
| P1-03 | scrypt PIN hashing with an explicit `maxmem`       |   ✅   |
| P1-04 | DB-backed sessions, hashed tokens, httpOnly cookie |   ✅   |
| P1-05 | Bootstrap, login with lockout, logout              |   ✅   |
| P1-06 | Members and roles, last-adult protection           |   ✅   |
| P1-07 | Locations, products, par levels                    |   ✅   |
| P1-08 | Lots: add, adjust, consume oldest-first, discard   |   ✅   |
| P1-09 | Inventory event log                                |   ✅   |

## Phase 2 · Scanning

| ID    | Task                                                        | Status |
| ----- | ----------------------------------------------------------- | :----: |
| P2-01 | Open Food Facts lookup with local caching                   |   ✅   |
| P2-02 | Category mapping from OFF taxonomy tags                     |   ✅   |
| P2-03 | Net-contents parsing from the label                         |   ✅   |
| P2-04 | Claude vision provider, structured output, refusal handling |   ✅   |
| P2-05 | Scan batches and candidates; nothing auto-applies (D-006)   |   ✅   |
| P2-06 | Candidate → product linking by exact name                   |   ✅   |
| P2-07 | Browser barcode scanning, native with a ZXing fallback      |   ✅   |

## Phase 3 · Shopping & requests

| ID    | Task                                               | Status |
| ----- | -------------------------------------------------- | :----: |
| P3-01 | Shopping list CRUD, open to everyone               |   ✅   |
| P3-02 | Duplicate suppression on open lines                |   ✅   |
| P3-03 | Par-level sweep                                    |   ✅   |
| P3-04 | Checkout: bought lines become stock                |   ✅   |
| P3-05 | Family requests with an approval path              |   ✅   |
| P3-06 | Approved grocery requests land on the list (D-012) |   ✅   |

## Phase 4 · Meals

| ID    | Task                                              | Status |
| ----- | ------------------------------------------------- | :----: |
| P4-01 | Recipes and ingredients                           |   ✅   |
| P4-02 | Loose ingredient names matched to the catalogue   |   ✅   |
| P4-03 | Availability, scaled by servings                  |   ✅   |
| P4-04 | Meal plan by date and slot                        |   ✅   |
| P4-05 | Cook: draw stock down, add shortfalls to the list |   ✅   |
| P4-06 | Dashboard summary                                 |   ✅   |

## Phase 5 · Web app

| ID    | Task                                                | Status |
| ----- | --------------------------------------------------- | :----: |
| P5-01 | Typed API client sharing server types               |   ✅   |
| P5-02 | Design tokens, light and dark, phone-first layout   |   ✅   |
| P5-03 | Sign-in: member picker and PIN pad; first-run setup |   ✅   |
| P5-04 | Dashboard                                           |   ✅   |
| P5-05 | Scan: barcode and photo, with a confirmation step   |   ✅   |
| P5-06 | Pantry: search, per-lot detail, use and add         |   ✅   |
| P5-07 | Shopping, meals, recipes, requests                  |   ✅   |
| P5-08 | Settings: people, places, scanning status           |   ✅   |

## Phase 6 · Deployment

| ID    | Task                                                              | Status |
| ----- | ----------------------------------------------------------------- | :----: |
| P6-01 | Multi-stage Dockerfile, non-root, healthcheck                     |   ✅   |
| P6-02 | Compose stack; database not published                             |   ✅   |
| P6-03 | Migrations on boot (D-015)                                        |   ✅   |
| P6-04 | CI: lint, format, typecheck, tests on real Postgres, build, image |   ✅   |
| P6-05 | Development seed                                                  |   ✅   |

## Phase 7 · Living with it — **next**

Nothing here is needed to start using the app. These are the things a month of
actual use will probably ask for.

| ID    | Task                                                | Status | Note                                                                                                                             |
| ----- | --------------------------------------------------- | :----: | -------------------------------------------------------------------------------------------------------------------------------- |
| P7-01 | Run it on the real hardware and fix what that finds |   ⬜   | The only task that matters until it is done. Three boot-blocking bugs already found by rendering the compose file — see NOTES.md |
| P7-02 | Offline shell via a service worker                  |   ⬜   | The pantry list should open in a basement freezer                                                                                |
| P7-03 | Barcode scanning on a real iPhone                   |   ⬜   | ZXing fallback path is untested on device                                                                                        |
| P7-04 | Photo scan accuracy pass against real counter shots |   ⬜   | Tune the prompt against what it actually gets wrong                                                                              |
| P7-05 | Expiry reminders (push or a daily digest)           |   ⬜   | Needs a decision on delivery first                                                                                               |
| P7-06 | Bulk edit in the pantry                             |   ⬜   | Putting a whole shop away is still per-item                                                                                      |
| P7-07 | Recipe import from a URL                            |   ⬜   | Paste a link, get ingredients                                                                                                    |
| P7-08 | "What can I make right now" as a screen             |   ⬜   | The data is already computed                                                                                                     |
| P7-09 | Usage rates from the event log                      |   ⬜   | Would make par levels suggest themselves                                                                                         |

---

## Cut

| ID  | Task                                             | Reason                                                              |
| --- | ------------------------------------------------ | ------------------------------------------------------------------- |
| —   | Nutrition and calorie tracking                   | Different product. OFF returns it; we do not store it. `PRODUCT.md` |
| —   | Price and budget tracking                        | Needs receipt parsing to be worth anything                          |
| —   | Native mobile apps                               | A PWA gets the camera and the home screen icon                      |
| —   | Automatic depletion guessing                     | An invented number is worse than a missing one                      |
| —   | Server-side refusal fallbacks on the vision call | No realistic refusal path for groceries; D-013                      |
