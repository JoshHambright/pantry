# scripts

Development tooling. None of this ships in the image.

| Script                   | What it is for                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `dev-db.sh`              | Start a native PostgreSQL when Docker is unavailable                                      |
| `stub-vision-server.mjs` | The real API with a canned vision provider, so the photo-scan flow can be driven for free |
| `ui-walkthrough.mjs`     | Drive every screen in Chromium and screenshot it                                          |
| `offline-check.mjs`      | Prove the installed app still works with the network cut                                  |

## dev-db.sh

`docs/DEPLOY.md` describes the normal path — `docker compose up -d db`. This is
the fallback for the Claude Code cloud container, where the docker CLI exists
but no daemon does.

```bash
./scripts/dev-db.sh start      # initdb if needed, create both databases, print URLs
./scripts/dev-db.sh status
./scripts/dev-db.sh reset      # drop and recreate; run pnpm db:migrate after
./scripts/dev-db.sh stop
```

It installs nothing. If postgres is missing it says so and suggests
`apt-get install -y postgresql`.

## stub-vision-server.mjs

Photo scanning costs an API call per photo, which makes it the feature least
likely to get exercised by hand. This serves the real app with a fixed set of
candidates chosen to cover the interesting cases — a count, a branded item, a
weight, one that matches an existing product, and one below the 0.6 confidence
bar so it starts unticked.

```bash
pnpm build
DATABASE_URL=postgres://pantry@127.0.0.1:5433/pantry node scripts/stub-vision-server.mjs
```

## ui-walkthrough.mjs

Not a test — the assertions live in Vitest. This catches what tests cannot: a
screen that renders but reads wrong. Two wording bugs got past a green suite and
were caught here.

```bash
node scripts/ui-walkthrough.mjs --base http://127.0.0.1:8080
node scripts/ui-walkthrough.mjs --base http://127.0.0.1:8098 --scan   # with the stub server
```

Screenshots land in `.walkthrough/`, which is gitignored. It exits non-zero on
any page or console error. Needs the demo seed (`pnpm db:seed`) for the member
and PIN it signs in with; override with `--member` and `--pin`.

Playwright is not a dependency of this workspace — it is a large install CI
never needs. Add it when you want this script: `pnpm add -Dw playwright`. The
script says so if it is missing.

Playwright's bundled Chromium may not match what is installed. It defaults to
the cloud image's browser at `/opt/pw-browsers/chromium-1194/...`; set
`CHROME_PATH` to point elsewhere, or `USE_BUNDLED_CHROMIUM=1` on a machine where
`npx playwright install` has been run.

## offline-check.mjs

A manifest makes the app installable; only a service worker makes it usable
offline. This signs in, cuts the network, reloads, and asserts three things: the
shell renders, the pantry still lists products from cache, and the offline
banner is showing — stale data that looks live would be worse than a white
screen. It also checks that a write is refused rather than silently lost.

```bash
pnpm build
DATABASE_URL=... PORT=8099 WEB_DIST=apps/web/dist node apps/api/dist/index.js &
node scripts/offline-check.mjs --base http://127.0.0.1:8099
```

Exits non-zero if any of those fail. Not in CI: it needs a built app, a
database, a server and a browser — a lot of moving parts for a check that only
changes when the service worker config does.
