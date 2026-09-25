# Pantry — Decision Log

One entry per non-obvious choice, so future-us knows _why_ and does not
re-litigate it.

Format: **What we chose · Why · What it costs · Status**

---

### D-001 · TypeScript monorepo, pnpm workspaces

**Chose:** One pnpm workspace: `packages/shared`, `apps/api`, `apps/web`.
**Why:** The unit and inventory maths are the heart of this app and both halves
need them. Putting them in a shared package means the rules that decide "you are
150 g short of rice" are written once, tested once, and cannot drift between the
server's answer and the screen's.
**Costs:** A build step between shared and its consumers, and a stale-`dist`
trap that cost real debugging time (see D-014).
**Status:** ✅ Accepted

---

### D-002 · Self-hosted: Docker Compose, Postgres, one box

**Chose:** Two containers — the app and Postgres — on hardware Josh owns.
**Why:** It is a household inventory. The data is a list of what is in the
fridge, which is nobody's business but the family's, and it should keep working
when a vendor changes their free tier. Postgres because the data is relational
(lots belong to products belong to households) and because `pg_dump` is a
backup story anyone can follow.
**Costs:** Josh owns uptime and backups. Reaching it from outside the house
needs Tailscale or a tunnel — covered in `DEPLOY.md`.
**Status:** ✅ Accepted

---

### D-003 · One image serves the API and the web app

**Chose:** The API serves `apps/web/dist` as static files when `WEB_DIST` is set.
**Why:** A Pi running three containers plus a reverse proxy to serve one small
app is more moving parts than the job needs. One origin also means no CORS and
no cross-site cookie rules to get wrong.
**Costs:** The web app cannot be deployed separately to a CDN. It does not need
to be — the only clients are on the home network.
**Status:** ✅ Accepted

---

### D-004 · PIN sign-in, scrypt-hashed, with a lockout

**Chose:** 4–8 digit PINs, hashed with scrypt at N=2^15, r=8, plus an account
lockout after 8 wrong tries.
**Why:** The alternative is passwords, and a password a nine-year-old will type
on a phone in a kitchen is a password nobody will use. A PIN has ~13 bits of
entropy, which is indefensible on the open internet and fine behind a lockout on
a home LAN. The lockout is the control that matters; the hash cost is what makes
a stolen database dump not immediately yield every PIN.
**Costs:** ~150 ms per sign-in. Not viable if this were ever exposed publicly
without a second factor.
**Note:** scrypt at these parameters needs ~33 MB, over Node's 32 MB default
`maxmem`. It must be passed explicitly or every hash throws.
**Status:** ✅ Accepted

---

### D-005 · Open Food Facts for barcode lookup, cached locally

**Chose:** Look up an unknown barcode against Open Food Facts, then save the
product locally so the second scan needs no network.
**Why:** Free, no key, no quota, and good coverage of US packaged groceries.
Being community-maintained, fields are often missing — every mapping treats
absence as normal and a miss falls through to a plain form.
**Costs:** Coverage gaps, especially store brands. A miss is a normal outcome,
not an error.
**Status:** ✅ Accepted

---

### D-006 · Vision output is a proposal, never an action

**Chose:** A photo scan writes `scan_candidates` and stops. Nothing reaches the
inventory until a human ticks it and taps Add. Candidates the model was less
than 60% sure of start unticked.
**Why:** A model that miscounts six yogurts as eight has made a small error; an
inventory that silently drifts from reality is useless, and nobody will notice
until they are missing an ingredient mid-recipe. The confirmation step is the
whole reason the feature can be trusted.
**Costs:** One extra screen. Worth it.
**Status:** ✅ Accepted

---

### D-007 · Photos are never written to disk

**Chose:** Scan images are read into memory, sent to Anthropic, and dropped. No
file is stored; only the resulting text candidates are.
**Why:** A photo of a kitchen counter catches more than groceries — mail, the
people in the room, whatever else is out. A household server should not quietly
accumulate that, and nothing in the product needs the original image once the
list exists.
**Costs:** A failed scan cannot be retried without taking the photo again.
**Status:** ✅ Accepted

---

### D-008 · Units convert only within a conversion group

**Chose:** Mass converts to mass, volume to volume, and **every discrete
packaging unit is its own group**. `each` and `dozen` share one. A can does not
convert to a bag, and nothing converts to grams.
**Why:** The obvious model — one `count` dimension — would happily add 3 cans to
2 bags and report 5. Density would be needed to turn cans into grams and we do
not have it. Refusing to guess is the correct answer: the app reports "2 cans
and 500 g" as two totals, which is what is actually true.
**Costs:** A recipe asking for 300 g of something stocked as "2 bags" reports a
shortfall instead of solving it. That is the honest answer and the UI says so.
**Status:** ✅ Accepted

---

### D-009 · Stock is lots, not a number per product

**Chose:** Each purchase is a row with its own quantity, location, expiry and
purchase date. Totals are computed.
**Why:** Expiry is per-purchase. Two cartons of milk bought a week apart are not
interchangeable, and "use the one that goes off first" is only expressible if
they are separate rows. It also makes the freezer-vs-fridge question answerable.
**Costs:** More rows and an aggregation step on read. Irrelevant at household
scale.
**Status:** ✅ Accepted

---

### D-010 · Totals are reported in the unit the food was stocked in

**Chose:** The largest holding chooses the display unit. Grams and millilitres
promote to kg and L past 1000; nothing else is converted for display.
**Why:** The first version normalised everything to metric, so 1.5 lb of chicken
came back as "680.389 g". Correct, and useless to the person holding the packet.
**Costs:** Two products of the same food bought in different units display in
whichever is larger. Acceptable and rare.
**Status:** ✅ Accepted

---

### D-011 · Children can ask, not change

**Chose:** `child` members can read the pantry and the plan, and create and
withdraw their own requests. Every write to stock, the plan, recipes or members
requires an `adult`.
**Why:** It is the requested behaviour — kids make requests — and it means the
inventory cannot be corrupted by someone exploring the app. Requests are a real
feature with a real approval path, not a read-only consolation.
**Costs:** A teenager who genuinely does the shopping needs promoting to adult.
That is a one-tap change in Settings.
**Status:** ✅ Accepted

---

### D-012 · Approving a grocery request puts it on the list

**Chose:** Answering "yes" to a grocery request adds the item to the shopping
list automatically.
**Why:** Otherwise "approved" is a label that changes nothing and the request
board becomes theatre. The approval has to move something.
**Costs:** None observed.
**Status:** ✅ Accepted

---

### D-013 · Claude Opus 5 for photo scanning; refusals handled, no server-side fallback

**Chose:** `claude-opus-5` with adaptive thinking at medium effort, structured
output via a zod schema, and an explicit check for `stop_reason: 'refusal'`.
No `fallbacks` parameter.
**Why:** A refusal arrives as a normal HTTP 200, so it has to be checked or it
surfaces as "Claude returned something unreadable" — the check is the part that
matters, and it is in. The server-side fallback beta was left out deliberately:
identifying groceries on a counter has no realistic path to a safety decline,
and a beta-gated parameter on a box in a closet is a moving part with no
corresponding benefit. Revisit if a refusal is ever actually observed.
**Costs:** If a photo ever were declined, the user gets a clear message and no
automatic retry on another model.
**Status:** ✅ Accepted

---

### D-014 · Tests resolve `@pantry/shared` to source, not to `dist`

**Chose:** A Vitest alias pointing `@pantry/shared` at `packages/shared/src`.
**Why:** Resolving through the package exports meant the API tests ran against
whatever was last built. A stale `dist/` produced three failures that read
exactly like logic bugs and were not. Tests should never depend on a build step
having been remembered.
**Costs:** Tests exercise source rather than emitted output. The build is
covered separately by `pnpm build` in CI.
**Status:** ✅ Accepted

---

### D-015 · Migrations run on boot

**Chose:** `apps/api/src/index.ts` runs pending migrations before listening.
**Why:** The deploy story is `docker compose pull && docker compose up -d`. A
separate migration step is a step that gets forgotten, and the failure mode is a
confusing runtime error rather than a clear startup one.
**Costs:** Two app containers starting at once would race. There is one.
**Note:** The entrypoint guard here must compare realpaths against `argv[1]`.
`import.meta.url.endsWith('migrate.js')` is also true when the module is
_imported_, which made the server migrate and then `process.exit(0)` before it
ever listened.
**Status:** ✅ Accepted

---

### D-016 · Empty lots are deleted; history lives in events

**Chose:** A lot drawn down to zero is removed. `inventory_events` keeps the
record of what happened.
**Why:** Keeping zero-quantity rows means every read has to filter them and the
pantry screen slowly fills with ghosts. The audit trail is a separate concern
and a separate table, which is also what makes "what did we use this month"
answerable.
**Costs:** A lot's expiry date is not recoverable after it empties. Nothing
needs it.
**Status:** ✅ Accepted

---

### D-017 · Offline is read-only, and says so

**Chose:** A service worker precaches the app shell and caches `GET /api/*`
responses (network-first). Writes are never queued or replayed — they fail. A
banner says the app is offline whenever the browser thinks it is.
**Why:** A chest freezer in a basement is exactly where you want to check
whether you already have mince, and exactly where there is no signal. Showing
the last known inventory there is genuinely useful. Queuing _writes_, though,
would mean two phones editing the same pantry from stale state and reconciling
later — which is how an inventory silently stops matching the kitchen, the one
failure this product cannot afford (see `PRODUCT.md`, "never silently guess").
Refusing the write is honest and costs nothing: whoever is holding the food can
do it again upstairs.
**Costs:** No offline editing. Cached data can be stale, which is why the
banner is not optional.
**Status:** ✅ Accepted

---

### D-018 · The precache size limit is deliberately loose

**Chose:** `maximumFileSizeToCacheInBytes` at 4 MB, well above anything the
build currently produces.
**Why:** A limit tuned just above today's bundle is a trap. The day the main
chunk grows past it, that chunk silently drops out of the precache, the app
stops working offline, and nothing fails — not the build, not CI, not a test.
The cost of being generous is one ~125 KB gzipped chunk (ZXing, which only
Safari loads) fetched once on a home network.
**Costs:** A slightly larger install. Immaterial at household scale.
**Status:** ✅ Accepted

---

### D-019 · Recipe import reads schema.org JSON-LD, and nothing else

**Chose:** `POST /recipes/import` fetches a page and reads its
`application/ld+json` Recipe block. No HTML scraping heuristics, no model call.
A page without structured data gets a clear "paste the ingredients instead".
**Why:** Recipe sites publish this markup because Google's rich results depend
on it, so it is both widespread and stable. That makes the importer
deterministic, free, offline-testable, and immune to a site restyling itself.
An LLM fallback would cost money per import and turn a reliable feature into a
probabilistic one, to rescue the minority of pages that publish nothing — and
the recipe form already parses pasted lines like "2 lbs chicken thighs".
**Costs:** Pages with no JSON-LD cannot be imported. They can be pasted.
**Status:** ✅ Accepted

---

### D-020 · The importer refuses to fetch anything on the local network

**Chose:** Before fetching, the URL's host is checked _and resolved_, and any
answer in private, loopback, link-local or CGNAT space is refused. Redirects
are followed by hand so every hop gets the same check. Only http and https.
**Why:** This is the one endpoint that makes the server fetch an address a
person typed, and the server sits on a home network next to a router admin
page, a Postgres instance and whatever else is on the LAN. A hostname that
resolves to `192.168.1.1`, or a public URL that redirects there, would turn
"import a recipe" into "read anything in my house". Checking the spelling is
not enough — DNS is the attack.
**Costs:** A recipe genuinely hosted on the LAN cannot be imported. Nobody has
one.
**Status:** ✅ Accepted
