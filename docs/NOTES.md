# Working notes

Session notes and loose ends. `DECISIONS.md` holds settled choices and
`TRACKING.md` holds task status; this is the stuff that fits in neither — what
was actually verified and how, what only looks verified, and the rough edges
noticed in passing but deliberately not fixed.

Last updated: 2026-09-25.

---

## What is actually proven, and how

Worth being precise about, because "the tests pass" covers less than it sounds.

| Layer                    | How it was checked                                                                                                   | Confidence                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Unit and inventory maths | 40-odd unit tests over conversion groups, FIFO planning, par shortfall, quantity parsing                             | High — this is pure logic and fully covered                                             |
| API behaviour            | 60-odd integration tests against a real PostgreSQL 16, exercising HTTP through `app.inject`                          | High — real driver, real constraints, real cascades                                     |
| Role enforcement         | Tests per route family, including a child trying each adult-only write                                               | High                                                                                    |
| Household isolation      | A second household created directly in the DB, then queried through the API                                          | Moderate — one case, not exhaustive                                                     |
| The web UI               | Driven through every screen in Chromium (`scripts/ui-walkthrough.mjs`)                                               | Moderate — it renders and navigates; interactions beyond the happy path are unexercised |
| Photo scan flow          | Driven end to end against a canned provider: propose → confirm → apply                                               | Moderate — the _flow_ is proven, the model's accuracy is not                            |
| Production image         | The exact runtime layout (`pnpm deploy` output + drizzle + web) assembled and booted; CI builds the image            | Moderate — `docker compose up` itself has never been run                                |
| Compose configuration    | `docker compose config` renders and validates it without a daemon; the environment it produces is now a test fixture | Moderate — the rendered config is right, but nothing has orchestrated it                |
| Barcode scanning         | Code path reviewed, never executed against a camera                                                                  | **None**                                                                                |

### Specifically not proven

- **`docker compose up -d --build` has never been run.** No Docker daemon in the
  development container. CI builds the image and the runtime layout boots.
  `docker compose config` renders the file without a daemon, and doing that
  found three boot-blocking bugs (below), so the _configuration_ is checked even
  though the orchestration is not. Still untested: healthcheck ordering in
  practice, the named volume, and restart behaviour.
- **No camera has ever been pointed at this app.** Neither `BarcodeDetector` nor
  the ZXing fallback has run against real hardware. The ZXing path in particular
  is the one I would expect to need work, and it is the path iPhones take.
- **Photo scan accuracy is unknown.** The prompt was written from first
  principles and tested against a stub. It has never seen a real counter.
- **Open Food Facts has never actually been called.** Tests use a null lookup so
  CI stays offline. The mapping code is written against the documented v2 shape
  and reviewed, not exercised.

---

## Rough edges noticed and left alone

Each of these is a judgement call that a week of real use should settle. None is
a bug.

- **Milk appears twice on the dashboard** — once under "Use these soon" and once
  under "Running low". Both are true. Whether that reads as thorough or as noise
  depends on how many items are in each section in practice.
- **The ZXing fallback is a ~477 KB chunk** (125 KB gzipped). It loads only on
  browsers with no native `BarcodeDetector`, which today means Safari, which
  means every iPhone in the house. Worth revisiting if it feels slow on first
  scan.
- **The scan `hint` field is accepted by the API but not exposed in the UI.**
  Telling the model "this is the freezer haul" should measurably help. It was
  left out to keep the scan screen to one button.
- **Nothing is offline.** No service worker. Opening the pantry list in a
  basement with no signal currently fails. `P7-02`.
- **Putting a shop away is per-item.** Checkout handles the shopping list, but a
  big scan still means confirming a long list one row at a time. `P7-06`.
- **`preferredDisplayUnit` picks the largest holding's unit.** Two products of
  the same food bought in different units will display in whichever is bigger,
  which could flip between visits. Rare, and the alternative — a per-product
  preferred unit — is a setting nobody wants to fill in.
- **Session cleanup is opportunistic.** Expired rows are pruned on login rather
  than on a timer. Fine for four people; would not be for four hundred.

---

## Open questions for Josh

Things I could not decide from the outside.

1. **Where does it live, and behind what?** `DEPLOY.md` recommends Tailscale
   because the camera needs a secure context and it avoids opening a port. If
   there is already a reverse proxy in the house, that changes the setup step
   and the `COOKIE_SECURE` / `TRUST_PROXY` advice.
2. **Do the kids get their own devices, or a shared one?** Right now every
   member signs in with their own PIN. If it is a shared tablet on the counter,
   an always-signed-in "kiosk" member that can only view and request would be
   better than making a nine-year-old type a PIN.
3. **How should expiry reach you?** `P7-05` is blocked on this. A daily digest,
   a push notification, or just the dashboard badge are very different amounts
   of work and only one of them is worth building.
4. **Par levels have to be set by hand.** `P7-09` would infer them from the
   event log after a month or two of use. Until then, the "running low" feature
   only works for products someone bothered to configure.

---

## Reviving a dev environment

The cloud container has no Docker daemon and loses everything on reclaim. To get
back to a working setup:

```bash
pnpm install
./scripts/dev-db.sh start          # native postgres; prints the URLs to export
eval "$(./scripts/dev-db.sh status | grep export)"
pnpm build && pnpm db:migrate && pnpm db:seed
pnpm verify                        # everything CI runs
```

Then, to look at it rather than test it:

```bash
node scripts/stub-vision-server.mjs &          # real API, canned vision
node scripts/ui-walkthrough.mjs --base http://127.0.0.1:8098 --scan
```

On a normal machine with Docker, use `docs/DEPLOY.md` instead — `dev-db.sh`
exists only because this project is built in containers that cannot run
containers.

---

## Things that cost time, so they do not cost it twice

These are also in `CLAUDE.md` under "Traps already paid for", repeated here with
the detail:

- **`import.meta.url.endsWith('x.js')` is not an entrypoint check.** It is true
  when the module is imported too. The server migrated and then exited zero
  before listening, and the symptom was a container that "started fine" and
  served nothing.
- **scrypt's `maxmem` defaults to 32 MB.** At N=2^15, r=8 it needs ~33 MB, so
  every PIN hash threw. It would have been caught by the first sign-in.
- **A stale `packages/shared/dist` silently tests the old code.** Three tests
  failed in ways that read exactly like logic bugs. The Vitest alias in
  `vitest.config.ts` exists solely to make this impossible.
- **`pnpm deploy` takes one `--filter`**, and pnpm 10 refuses to deploy a
  non-injected workspace without `--legacy`. Both failed only in the CI image
  build, which is the slowest place to find out.
- **Node's type stripping does not rewrite `.js` specifiers to `.ts`.** Every
  import here is written `.js` because NodeNext requires it, so `node src/x.ts`
  cannot work. That is why `pnpm dev` runs under tsx.

Found on 2026-09-25 by rendering the compose file with `docker compose config`
and reading what it actually produces. All three would have hit on the first
deploy:

- **Compose substitutes an unset variable as `""`, not as absent.** So
  `ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}` arrived as an empty string, which
  is a _value_ that fails `z.string().min(1)`. Deploying without photo scanning
  — the documented default — died at boot on a config error. `loadEnv` strips
  empty values before parsing now, so defaults apply and optionals stay
  optional.
- **`openssl rand -base64 24` breaks `DATABASE_URL` about 40% of the time.** A
  `/` is illegal in a URL's userinfo and the driver's own error is a bare
  "Invalid URL". DEPLOY.md recommended exactly that command; it now recommends
  `openssl rand -hex 32`, and the env schema catches an unparseable URL with a
  message naming percent-encoding as the fix.
- **The `./backups` bind mount would have been created by Docker as root**,
  leaving the backup command in DEPLOY.md — which redirects on the _host_ —
  unable to write. The directory is tracked now (via `.gitkeep`) so it exists,
  owned by whoever cloned.

The lesson worth keeping: "CI builds the image" and "the app runs" together say
nothing about whether `docker compose up` works. The compose file is its own
artefact and needs its own check.
