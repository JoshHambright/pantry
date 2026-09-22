# Pantry

A grocery inventory and meal planner for one household, running on your own
hardware. Scan groceries in by barcode or by photographing the counter, know
what is actually in the house, plan meals against it, and let the shopping list
fill itself.

Built for two adults who run the kitchen and two kids who can ask for things.

---

|                                                          |                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| ![The kitchen dashboard](docs/screenshots/dashboard.png) | ![Confirming a photo scan](docs/screenshots/scan-review.png)  |
| What needs attention today                               | A photo scan, waiting to be confirmed                         |
| ![The pantry](docs/screenshots/pantry.png)               | ![A recipe scored against stock](docs/screenshots/recipe.png) |
| What is in the house                                     | What you can make with it                                     |

_Screenshots use the demo seed data._

---

## What it does

**Scan groceries in.** Point the phone at a barcode and it resolves against Open
Food Facts. For anything without one — loose produce, bulk bags, a whole counter
of shopping — photograph it and Claude reads the items back as a list you
confirm. Nothing enters the pantry until you agree with it.

**Know what is on hand.** Quantities, where they are, when they expire. Each
purchase is tracked separately, so "use the milk that goes off first" is a
question the app can answer.

**Plan meals against reality.** Recipes are scored against current stock, so you
know what you can make tonight and exactly what you are short of. Cooking a
planned meal draws the ingredients down and puts the shortfall on the list.

**A list that fills itself.** Items below their par level queue themselves.
Approved requests from the kids queue themselves. At the end of a shop, one tap
turns the trolley into inventory.

**Kids can ask.** A request board for meals and groceries, with a real approval
path — saying yes to a grocery request puts it on the list.

---

## Running it

```bash
git clone https://github.com/JoshHambright/pantry.git
cd pantry
cp .env.example .env     # set POSTGRES_PASSWORD
docker compose up -d --build
```

Open `http://<the-box>:8080` and the first screen sets up the household.

Photo scanning needs an `ANTHROPIC_API_KEY` in `.env`. Everything else works
without one.

**The camera needs HTTPS.** Browsers refuse camera access on plain HTTP outside
`localhost`, so scanning from a phone needs Tailscale or a reverse proxy in
front. [`docs/DEPLOY.md`](docs/DEPLOY.md) covers it in three commands.

---

## Developing

```bash
pnpm install
docker compose up -d db
pnpm db:migrate && pnpm db:seed     # demo household; every PIN is 1234
pnpm dev                            # API :8080, web :5173
```

```bash
pnpm verify    # lint, format, typecheck, test, build — everything CI runs
```

Integration tests need a database and skip without one:

```bash
export TEST_DATABASE_URL=postgres://pantry:pantry@127.0.0.1:5432/pantry_test
pnpm test
```

---

## How it is put together

```
packages/shared   units, inventory maths, zod schemas, shared types
apps/api          Fastify + Drizzle + Postgres; also serves the built web app
apps/web          React + Vite PWA, phone-first
```

The maths that decides "you are 150 g short of rice" lives in `shared` and is
used by both sides, so the server's answer and the screen's cannot disagree.

Two ideas are load-bearing:

**Units convert only within their own group.** Mass to mass, volume to volume,
and every packaging unit is its own group — a can is not a bag and neither is
grams. So the app reports "2 cans and 500 g" as two totals instead of inventing
a number. ([D-008](docs/DECISIONS.md))

**The model proposes; a person decides.** A photo scan writes candidates and
stops. Anything it was unsure about starts unticked. An inventory that drifts
from reality is worse than one with gaps, because a wrong number gets trusted.
([D-006](docs/DECISIONS.md))

---

## Documentation

| File                                     | Contents                                                             |
| ---------------------------------------- | -------------------------------------------------------------------- |
| [`docs/PRODUCT.md`](docs/PRODUCT.md)     | What this is for, who can do what, what is deliberately out of scope |
| [`docs/DEPLOY.md`](docs/DEPLOY.md)       | Running it on a Pi, Tailscale, backups, troubleshooting              |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why it is built the way it is. Read before changing an approach      |
| [`docs/API.md`](docs/API.md)             | Endpoint reference                                                   |
| [`docs/TRACKING.md`](docs/TRACKING.md)   | Live build tracker                                                   |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)     | Phases and exit criteria                                             |

---

## Privacy

It runs on your hardware and the database never leaves it. Two things reach the
internet, both only when used:

- **Barcode lookups** send the barcode digits to Open Food Facts.
- **Photo scans** send the photo to Anthropic to be identified. The photo is
  never written to your server's disk, and only the resulting text is kept.

Turn photo scanning off by leaving `ANTHROPIC_API_KEY` blank; everything else
keeps working.

## Licence

MIT.
