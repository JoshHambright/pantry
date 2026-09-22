# CLAUDE.md — Pantry

Guidance for Claude Code working in this repository.

---

## ⚠️ The VM is ephemeral. Commit and push often.

This project is developed in Claude Code cloud sessions. The container is
temporary and is reclaimed after inactivity or when the session ends. When that
happens the conversation is restored — **the filesystem is not.** Uncommitted
work is gone, with no recovery path.

**GitHub is the only durable storage.**

1. Push at every meaningful checkpoint: a passing suite, a finished feature, the
   end of a session. Do not batch pushes.
2. Commit before anything that could stall or time out.
3. Push, don't just commit. A local commit dies with the container.
4. A WIP commit that survives beats perfect work that doesn't:
   `git commit -m "WIP P7-02: service worker, not yet registered"`
5. Verify the push landed. Don't assume.

```bash
git status -sb   # tree clean? branch in sync? if not, you are not done.
```

**Branch:** `claude/grocery-inventory-tracker-es7llp`. Never push elsewhere
without explicit permission.

### Resuming after a purge

1. `git log --oneline -10` — the last push is where we actually are.
2. `docs/TRACKING.md` — task status is the source of truth for progress.
3. `docs/DECISIONS.md` — do not re-litigate settled decisions.
4. `docs/NOTES.md` — what is actually proven, what only looks proven, and the
   open questions. It also has the command sequence to rebuild a working dev
   environment from a fresh container.

**There is no Docker daemon in a cloud session.** `./scripts/dev-db.sh start`
brings up a native Postgres instead; `scripts/README.md` covers that and the
other two dev scripts.

The tracker is updated **in the same commit as the work it describes**. It is
the handoff mechanism, not documentation.

---

## What this is

A self-hosted grocery inventory and meal planner for one family. Full scope and
principles in `docs/PRODUCT.md`. The short version: it has to be faster than not
using it, and it must never silently guess a number.

```
packages/shared   units, inventory maths, zod schemas, shared types
apps/api          Fastify + Drizzle + Postgres; also serves the built web app
apps/web          React + Vite PWA, phone-first
```

---

## Working on it

```bash
pnpm install
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
# ...or, with no docker daemon: ./scripts/dev-db.sh start
pnpm db:migrate && pnpm db:seed      # every PIN is 1234
pnpm dev                             # API :8080, web :5173
pnpm verify                          # everything CI runs
```

Integration tests need a database:

```bash
export TEST_DATABASE_URL=postgres://pantry:pantry@127.0.0.1:5432/pantry_test
pnpm test
```

Without it they skip and only the pure unit tests run — so **a green `pnpm test`
with no `TEST_DATABASE_URL` proves much less than it looks like it does.** Set it.

After changing `packages/shared`, run `pnpm build` before anything reads its
`dist` (the Docker build, a manual `node dist/...` run). Tests are aliased to
source and are not affected — see D-014 for why that alias exists.

After changing `apps/api/src/db/schema.ts`:

```bash
pnpm db:generate     # writes apps/api/drizzle/NNNN_*.sql — commit it
```

---

## Conventions

- **Optional inputs on public functions take `?: T | undefined`**, not bare
  `?: T`. `exactOptionalPropertyTypes` makes a bare optional reject an explicit
  `undefined`, and callers legitimately hold absent values. Bare `?:` is still
  right for internal config objects a caller builds literally.
- **Task IDs in commit messages**: `P4-05: <what changed>`. IDs come from
  `docs/TRACKING.md`.
- **A task is ✅ only when its tests pass in CI**, not when the code works.
- **Non-obvious choices get a `DECISIONS.md` entry.**
- **Cut scope is recorded, not deleted** — mark ❌ with a reason.
- Comments explain _why_, not _what_. If a line needs a comment to say what it
  does, rewrite the line.

---

## Constraints that are already settled

Do not rediscover or re-argue these. Reasoning is in `docs/DECISIONS.md`.

- **Units convert only within their own group.** Mass to mass, volume to volume,
  and every packaging unit is its own group. A can is not a bag and neither is
  grams. Two incompatible holdings are reported as two totals — that is correct,
  not a missing feature (D-008).
- **Totals display in the unit the food was stocked in.** Normalising to metric
  is a bug: 1.5 lb of chicken must not read as "680.389 g" (D-010).
- **Rounding is for display only.** `StockTotal.quantity` is rounded;
  `StockTotal.baseQuantity` is not. Arithmetic reads `baseQuantity`. Feeding a
  rounded total back through a conversion is how "half a gallon" became 0.4999.
- **Vision output is a proposal.** A scan writes candidates and stops. Nothing
  reaches the inventory without a human confirming it, and anything below 60%
  confidence starts unticked (D-006).
- **Photos are never written to disk** (D-007).
- **Children can ask, not change.** Every stock, plan, recipe or member write
  requires an adult (D-011).
- **Empty lots are deleted.** History lives in `inventory_events` (D-016).
- **The camera needs a secure context.** `getUserMedia` is unavailable on plain
  HTTP outside `localhost`. This is why `DEPLOY.md` leads with Tailscale.
- **`COOKIE_SECURE=true` without TLS in front makes sign-in impossible.** The
  cookie is simply never sent. It is the first thing to check on "nobody can log
  in".
- **CI never needs real credentials.** The vision provider is stubbed and the
  barcode lookup is a null implementation. Keep it that way.

---

## Traps already paid for

- **Entrypoint guards.** `import.meta.url.endsWith('thing.js')` is true when the
  module is _imported_, not only when it is run. It made the server migrate and
  then `process.exit(0)` before listening. Use `isEntrypoint()` from
  `apps/api/src/entrypoint.ts`.
- **scrypt and `maxmem`.** At N=2^15, r=8 scrypt needs ~33 MB, over Node's 32 MB
  default. Without an explicit `maxmem` every PIN hash throws.
- **Stale `packages/shared/dist`.** Resolving through package exports tests
  whatever was last built. Three failures once looked exactly like logic bugs
  and were a forgotten build step (D-014).
- **Route ordering.** Fastify's router prefers static segments over parametric
  ones, so `/recipes/availability` beats `/recipes/:id` regardless of
  registration order. Do not "fix" this by reordering.

---

## Secrets

**Never commit credentials.** `ANTHROPIC_API_KEY` and the database password live
in a gitignored `.env`. `.env.example` documents the shape and holds no real
values. PINs are scrypt hashes; session cookies are stored only as SHA-256
digests.
