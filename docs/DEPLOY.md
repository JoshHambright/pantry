# Deploying Pantry

Two containers on a machine you own: the app, and Postgres. Anything that can
run Docker will do — a Raspberry Pi 5, an old laptop, a NUC, a NAS.

---

## 1. Requirements

- Docker with Compose v2 (`docker compose version`)
- ~1 GB of disk for the image and the database
- Arm64 and amd64 both work; the image builds from source on the host

On a Pi, use 64-bit Raspberry Pi OS and an SSD or a good A2 card. Postgres on a
cheap SD card will be slow and will eventually corrupt.

---

## 2. First run

```bash
git clone https://github.com/JoshHambright/pantry.git
cd pantry
cp .env.example .env
```

Edit `.env`. The only value you must set is the database password:

```bash
# generates something worth using
openssl rand -base64 24
```

Then:

```bash
docker compose up -d --build
docker compose logs -f app     # watch it migrate and start
```

Open `http://<the-box>:8080`. The first screen sets up the household and your
own PIN. Add everyone else from Settings afterwards.

Migrations run automatically on every start, so upgrades are just:

```bash
git pull && docker compose up -d --build
```

---

## 3. Turning on photo scanning

Barcode scanning, inventory, meal planning and everything else work without
this. Photo scanning is the one feature that needs an API key.

1. Get a key at <https://console.anthropic.com>.
2. Put it in `.env` as `ANTHROPIC_API_KEY=sk-ant-...`.
3. `docker compose up -d`.

Settings will show photo scanning as on. Photos are sent to Anthropic to be
identified and are **not** written to disk on your server (D-007). Costs are
per-photo and small, but they are real — a scan is one API call.

To turn it off again, blank the variable and restart.

---

## 4. Reaching it from a phone

### On the home network

`http://<the-box>:8080` works as-is. Add it to the home screen on each phone and
it behaves like an app.

**The camera will not work over plain HTTP** except on `localhost`. Browsers
require a secure context for `getUserMedia`. So barcode and photo scanning need
one of the options below even inside the house.

### Tailscale (recommended)

Gives you HTTPS, a stable name, and access from outside the house, without
opening a port on your router.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale serve --bg 8080
```

`tailscale serve` terminates TLS for you. Because something is now in front of
the app, set both of these in `.env` and restart:

```
COOKIE_SECURE=true
TRUST_PROXY=true
```

The app is then at `https://<machine>.<tailnet>.ts.net` for anyone signed into
your tailnet. Install Tailscale on each family phone once and it is permanent.

### A reverse proxy instead

Caddy or nginx in front of port 8080 works the same way. Set `COOKIE_SECURE=true`
and `TRUST_PROXY=true` whenever something else terminates TLS.

> Do not set `COOKIE_SECURE=true` without TLS in front. The browser will refuse
> to send the session cookie over plain HTTP and nobody will be able to sign in.

---

## 5. Backups

The whole pantry is one Postgres database. Back it up and you have lost nothing.

```bash
# a dated dump into ./backups, which the db container already mounts
docker compose exec -T db pg_dump -U pantry pantry \
  | gzip > "backups/pantry-$(date +%F).sql.gz"
```

A nightly cron on the host:

```cron
15 3 * * * cd /home/josh/pantry && docker compose exec -T db pg_dump -U pantry pantry | gzip > "backups/pantry-$(date +\%F).sql.gz" && find backups -name 'pantry-*.sql.gz' -mtime +30 -delete
```

Restoring:

```bash
gunzip -c backups/pantry-2026-09-22.sql.gz \
  | docker compose exec -T db psql -U pantry -d pantry
```

Copy `backups/` somewhere off the box periodically. A backup on the same disk as
the database is not a backup.

---

## 6. Developing on it

```bash
pnpm install
docker compose up -d db              # just the database
createdb / or use the compose one
pnpm db:migrate
pnpm db:seed                         # demo household, everyone's PIN is 1234
pnpm dev                             # API on :8080, web on :5173
```

The Vite dev server proxies `/api` to the API, so open `http://localhost:5173`.

Tests need a database of their own:

```bash
export TEST_DATABASE_URL=postgres://pantry:pantry@127.0.0.1:5432/pantry_test
pnpm test
```

Without `TEST_DATABASE_URL` the integration tests skip and the pure unit tests
still run.

`pnpm verify` runs everything CI runs.

---

## 7. Troubleshooting

**Nobody can sign in, and the PIN is definitely right.**
`COOKIE_SECURE=true` without TLS in front. The cookie is never sent. Set it to
`false`, or put Tailscale/Caddy in front.

**The camera button does nothing.**
Not a secure context. See section 4 — the page must be on HTTPS or `localhost`.

**Barcode scanning says it is unsupported.**
Safari has no `BarcodeDetector`; the app falls back to ZXing, which loads on
first use and is a ~120 KB download. If it still fails, type the digits in — the
field next to the scan button does the same lookup.

**A scan says photo scanning is off.**
No `ANTHROPIC_API_KEY` in the app container's environment. Check with
`docker compose exec app env | grep ANTHROPIC`.

**The app container restarts in a loop.**
`docker compose logs app`. Almost always either a bad `DATABASE_URL` or Postgres
not being ready — the compose file already waits on the healthcheck, so suspect
the URL first.

**Out of disk on a Pi.**
`docker system prune` clears old build layers, which accumulate fast when you
rebuild from source on each upgrade.
