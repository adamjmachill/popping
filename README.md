# Popping

Personal AI-ranked intelligence dashboard. Aggregates deals, vulnerabilities, news, sports, podcasts, YouTube, and more into a single scored feed.

Ships with RSS, Hacker News, Reddit, CVE (NVD + CISA KEV), GitHub releases, podcasts, YouTube, RedFlagDeals, Wikipedia "on this day" and generic-scrape sources, plus an LLM-written daily Brief.

## Quickstart

**Prebuilt images (production, no build step):**

```bash
cp .env.example .env             # then set POSTGRES_PASSWORD (openssl rand -hex 24)
docker compose up -d             # pulls ghcr.io/adamjmachill/popping-{backend,frontend}:latest
open http://localhost:14789      # frontend (the only published port)
```

The frontend publishes on `14789` by default — a 5-digit port in the
14xxx range chosen to stay out of the common 3000/5173/8000/8080/8443
range and below typical ephemeral-port territory (32768+). Override with
`POPPING_FRONTEND_PORT=<port>` in `.env` (nginx inside the container
listens on 8080; only the host-side mapping changes). The backend is reachable from
the frontend over the internal docker network (`http://backend:8000`);
postgres is entirely internal.

**The app has no login unless OIDC is enabled.** Anyone who can reach it
can change settings, delete sources and spend your LLM credit. The
frontend therefore binds to `127.0.0.1:14789` by default. On a VPS, keep
it that way: Docker's port rules bypass `ufw`, so `0.0.0.0` would be
public.

**Public deployment (Cloudflare Tunnel + Access)** — no open ports, TLS
handled by Cloudflare:

1. In Cloudflare Zero Trust, create a tunnel and copy its token. Give it a
   public hostname (e.g. `popping.example.com`) pointing at
   `http://frontend:8080`.
2. Add a Cloudflare Access application for that hostname that only allows
   your email.
3. In `.env` set `COMPOSE_PROFILES=tunnel`, `TUNNEL_TOKEN=<token>` and
   `PUBLIC_URL=https://popping.example.com`, then `docker compose up -d`.

**LAN deployments** — set `POPPING_FRONTEND_HOST=0.0.0.0`, put a reverse
proxy (Caddy / Traefik / Nginx) in front for TLS, and enable OIDC (see
below).

The first boot runs `alembic upgrade head` against a fresh postgres volume, so the schema is created automatically. The scheduler then fires one immediate fetch per plugin and re-fetches every `refresh_interval_seconds`.

**Updating to a new release:**

`POPPING_IMAGE_TAG=latest` (the default) tracks `main` — every push to `main` rebuilds both backend and frontend images and rolls the `latest` tag forward. To pick up a new release:

```bash
docker compose pull        # fetch the rotated :latest from GHCR
docker compose up -d       # recreate containers with the new image
```

`pull_policy` defaults to `always`, so a plain `docker compose up -d` already pulls when the digest moved; the explicit `pull` step is only needed if you've set `POPPING_PULL_POLICY=missing` or `=never` in your `.env` (intentional opt-out for change-windowed deployments — see `.env.example` for the trade-off).

**Server helpers (`ops/`):** two small scripts for a VPS install at `/opt/popping`.

- `ops/popping-update.sh`: `git pull`, `docker compose pull`, `up -d`, then `docker image prune -f` so old images don't fill the disk, and waits for the backend to report healthy.
- `ops/popping-backup.sh`: nightly `pg_dump` plus a copy of `.env` into `/root/backups`, kept 14 days. Install and restore steps are in the script header.

```bash
cp ops/popping-update.sh /usr/local/bin/popping-update && chmod 700 /usr/local/bin/popping-update
popping-update
```

**Local dev with hot-reload (build from source):**

```bash
cp .env.example .env
cp docker-compose.override.yml.example docker-compose.override.yml
docker compose up -d --build     # builds from ./backend and ./frontend, bind-mounts source
```

The override is auto-loaded by `docker compose up` and only adds `build:` + bind mounts; postgres stays pulled.

**Pin to a specific build:**

```bash
# In .env:
POPPING_IMAGE_TAG=sha-<full 40-char commit sha>    # exact commit (immutable)
# or
POPPING_IMAGE_TAG=pr-3           # test a PR
POPPING_PULL_POLICY=never        # don't auto-update a pinned tag
```

## Architecture

```
┌──────────────┐   ┌──────────────┐
│  Vite + R+T  │──▶│  FastAPI     │──┐
│  (frontend)  │   │  (backend)   │  │
└──────────────┘   └──────┬───────┘  │
                          │          │
                   ┌──────▼──────┐   │
                   │ APScheduler │   │
                   │  (sources)  │   │
                   └──────┬──────┘   │
                          │          │
              ┌───────────┴──────────┤
              ▼                      ▼
        ┌─────────┐            ┌─────────┐
        │Postgres │            │ Source  │
        │pgvector │            │ plugins │
        └─────────┘            └─────────┘
```

- **Backend** (`backend/`): FastAPI + SQLAlchemy 2 async + APScheduler + pgvector.
- **Frontend** (`frontend/`): Vite + React + Tailwind, served in production by nginx (`frontend/nginx.conf.template`), which also proxies `/api`, `/assets` and `/auth` to the backend.
- **Source plugins** (`backend/app/sources/`): drop a file, restart the backend, it's registered automatically via `@register_source`.
- **Storage**: Postgres 16 with pgvector (embedding storage). The backend runs as a single process; see `ARCHITECTURE.md`.

## API

| Endpoint                          | Purpose                                | Auth      |
| --------------------------------- | -------------------------------------- | --------- |
| `GET  /api/health`                | Liveness + counts                      | public    |
| `GET  /api/sources`               | Registered sources + last-fetch state  | public    |
| `GET  /api/sources/{id}`          | One source                             | public    |
| `GET  /api/entries`               | List entries (`?category=&source=&limit=`) | public |
| `GET  /api/foryou`                | Personal top-N feed (with convergence boost) | login |
| `POST /api/ingest/{source_name}`  | Force a fetch now (instead of waiting) | login     |
| `GET  /auth/login`                | Kick off the OIDC flow (302 to IdP)    | n/a       |
| `GET  /auth/callback`             | OIDC redirect URI                      | n/a       |
| `POST /auth/local`                | Local-user login (form on login page)  | n/a       |
| `GET  /auth/local/availability`   | `{"enabled": bool}` — does the login page show the local form? | n/a |
| `POST /auth/logout`               | Clear the session cookie + delete row  | n/a       |
| `GET  /auth/me`                   | Current user payload or 401            | n/a       |

Interactive docs at `http://<server-ip>:14789/api/docs`.

## OIDC / login

`OIDC_ENABLED=false` (the default) keeps the dashboard as a single-user app
with no login screen — fine for a personal loopback deployment. Set
`OIDC_ENABLED=true` for any LAN or public exposure, then configure the
remaining vars in `.env`:

```bash
OIDC_ENABLED=true
OIDC_ISSUER=https://auth.example.com       # your IdP's issuer URL
OIDC_CLIENT_ID=popping                    # public client (no secret)
OIDC_SCOPES=openid email profile
PUBLIC_URL=https://popping.example.com     # must match the reverse-proxy host
SESSION_SECRET=<openssl rand -hex 32>      # required when OIDC is on
```

The backend fetches the IdP's `/.well-known/openid-configuration` on the
first login, so the IdP doesn't need to be up at container start — it only
needs to be reachable when someone clicks **Sign in**.

Flow: browser → `GET /auth/login` (302 to IdP) → consent → `GET /auth/callback?code=...`
(exchange, set session cookie, 302 to `/`). Sessions are stateless signed
cookies (8 h, `HttpOnly`, `SameSite=Lax`, `Secure` when `PUBLIC_URL` is https).

**What's gated.** Reads (`/api/entries`, `/api/sources`, `/api/health`) stay
public so embed/preview use cases work without login. Mutations
(`/api/ingest/{name}` today, interactions and watchlist in a later phase)
require a session.

### Local fallback user

When the IdP is down (or you're testing without one), a hardcoded local
account can log in via `POST /auth/local` — the form on the login page
exposes it automatically. Configure:

```bash
LOCAL_AUTH_ENABLED=true
LOCAL_USER_NAME=alice
LOCAL_USER_PASSWORD_HASH=<bcrypt hash>
LOCAL_USER_EMAIL=alice@lan.local       # optional, display only
```

Generate the hash:
```bash
python -c "import bcrypt; print(bcrypt.hashpw(b'YOUR_PASSWORD', bcrypt.gensalt()).decode())"
```

The endpoint runs `bcrypt.checkpw` regardless of which field is wrong, so
the response time is constant (no username enumeration via timing).

### Local bypass

For "I'm at the server's keyboard (or on the same LAN) and don't want to
round-trip through the IdP" — flip on local bypass:

```bash
LOCAL_AUTH_BYPASS=true
```

Any request from a network address matching `LOCAL_BYPASS_ALLOWED_CIDRS`
(default: loopback `127.0.0.0/8` / `::1`) is treated as authenticated
with a synthetic `local-bypass` user. Every grant is logged at INFO
(`local-auth-bypass grant: ip=…`) so you can audit who came in.

The default is loopback-only — RFC1918 / link-local / ULA addresses
(Docker bridge, k8s pod CIDRs, reverse-proxy peers on a private
interface) are NOT auto-granted. To extend bypass to a private LAN,
set:

```bash
LOCAL_AUTH_BYPASS=true
LOCAL_BYPASS_ALLOWED_CIDRS=127.0.0.0/8,10.0.0.0/8,::1/128
```

**Be aware that any host on the allow-listed networks can then
authenticate without a password.**

**Security note.** The IP is taken from the TCP peer only —
`X-Forwarded-For` is deliberately ignored. A client can set that header
to anything it wants, and trusting it would let any LAN attacker claim
a loopback identity. If you run behind a reverse proxy, terminate TLS at
the proxy and have it speak to the backend on a private interface, or
add explicit proxy-trust support (out of scope here).

Off by default; only enable when you trust the network between clients
and the backend.

### Persistent sessions

Sessions are stored in the `sessions` table, not in the cookie. The
cookie carries only an opaque random ID; the row holds user data + TTL.
This means:

- **Restart-safe**: the backend can restart without logging anyone out.
- **Server-side revocation**: `POST /auth/logout` deletes the row.
- **Sliding TTL**: every authenticated request extends the expiry.
- **Audit-friendly**: `SELECT * FROM sessions` shows who's logged in.

A periodic purge (every hour by default; `SESSION_PURGE_INTERVAL_SECONDS`)
deletes expired rows.

### Authentik

1. *Applications* → *Create* → *OAuth2/OpenID*: name `popping`, provider
   *OAuth2*, client type *Public*, redirect URI
   `https://popping.example.com/auth/callback`.
2. *Providers* → *Create* → *OAuth2/OIDC*: authorization flow *Authorization
   code*, scopes *openid email profile*, signing key *Self-signed*.
3. Copy the client ID → `OIDC_CLIENT_ID`. Issuer URL → `OIDC_ISSUER`.

### Pocket-ID

1. *OIDC Clients* → *New*: name `popping`, redirect URI
   `https://popping.example.com/auth/callback`, scopes
   *openid email profile*, no client secret (PKCE only).
2. Copy the client ID → `OIDC_CLIENT_ID`. Issuer URL → `OIDC_ISSUER`.

### Google

`OIDC_ISSUER=https://accounts.google.com`, create an OAuth client in
Google Cloud Console with redirect URI `https://popping.example.com/auth/callback`.

## Phase 4 — The Brief + notifications

Phase 4 lights up the LLM router that phase 2 shipped and adds push
notifications. Three new endpoints; one new dashboard card; no
breaking changes to the schema beyond a new JSON column on
`briefs.meta` (used for dedup).

### The Brief

A daily AI-generated digest of the top 25 entries from the last 24h,
rendered as a card on the dashboard above For You. One LLM call per
Brief; no streaming. Tone defaults to `terse` (one line + 3-5
highlights + 1-3 watch items); `narrative` is also available.

**Triggers** — all three converge on `BriefGenerator.generate()`:

| Trigger | How | When |
| --- | --- | --- |
| Daily scheduled | APScheduler `CronTrigger(hour=BRIEF_SCHEDULE_HOUR)` | `BRIEF_SCHEDULE_HOUR` UTC (default 08:00). Set `-1` to disable. |
| Manual | `POST /api/brief/generate?tone=terse` | Header "Brief" button or Drawer button. Login-gated when OIDC is on. |
| Convergence | `BriefGenerator.generate_alert()` from the periodic convergence-check job | When a slug appears in `CONVERGENCE_NOTIFY_THRESHOLD` (default 2) sources within `CONVERGENCE_WINDOW_HOURS`. |

The LLM is picked via `app.llm.router.provider_for("brief")` — same
Anthropic → OpenAI → Groq → Ollama Cloud → Ollama local order as scoring.
If nothing is configured, the manual endpoint returns 503 ("no LLM
provider") and the scheduler logs and skips. The dashboard keeps working
with the existing Brief row. The provider / model can be overridden at
runtime via the Settings UI (Drawer → LLM chip → "change"); see
**Runtime settings** below.

### Notifications

Two backends, picked at startup. The Drawer shows which one is wired
up:

| Backend | Env vars | Notes |
| --- | --- | --- |
| Apprise (preferred) | `APPRISE_URL` | Opaque URL — `pover://…`, `tgram://…`, `discord://…`, `mailto://…`, `ntfy://…`. One library, 100+ services. |
| Pushover (fallback) | `PUSHOVER_USER_KEY` + `PUSHOVER_APP_TOKEN` | Plain `httpx` POST to `api.pushover.net/1/messages.json`. Used when `APPRISE_URL` is unset. |

**Three notification triggers:**

1. **Brief delivery** — every successful Brief generation pushes the
   full content via the configured backend.
2. **High-CVSS CVEs** — post-ingest hook in `_ingest` checks
   `meta.cvss_score` on newly-inserted rows. Sends a single batched
   alert per ingest when at least one entry exceeds
   `CVE_NOTIFY_MIN_CVSS` (default 7.0). Deduped via
   `Brief.meta.notified_urls` (GIN-indexed JSON containment).
3. **Convergence alerts** — periodic job (every
   `CONVERGENCE_CHECK_INTERVAL_MINUTES`, default 15) scans for
   unalerted clusters, fires `generate_alert()` (one-sentence
   `tone="alert"` Brief), and pushes that.

`Notifier.send()` is best-effort — transport failures are logged but
never raise. A broken notifier can't break ingest.

### Settings / Drawer

The Drawer now shows a "Notifications" chip at the top with the
configured backend (e.g. `configured (apprise · pover)`) plus a
"Generate brief now" button. The full settings drawer (followed
categories, source weight tuning) is still a follow-up — the model
columns exist but the UI isn't built yet.

### API additions

| Endpoint | Purpose | Auth |
| --- | --- | --- |
| `GET  /api/brief/latest?tone=&limit=` | Most recent Brief(s). Latest of each tone when `tone` is omitted. | public |
| `POST /api/brief/generate?tone=terse\|narrative` | Synchronously generate a new Brief. | login when OIDC on |
| `GET  /api/notifications/status` | `{configured, backend, scheme}` — Drawer chip. | public |
| `GET  /api/settings` | Runtime-overridable settings (`llm.provider`, `llm.model_brief`, `llm.model_scoring`). All fields nullable. | login when OIDC on |
| `PUT  /api/settings/llm` | Persist one or more LLM knobs. Empty string clears the override. | login when OIDC on |
| `GET  /api/llm/tags?provider=&refresh=` | Ollama-style model list (1 h TTL cache). The Drawer picker uses this to populate the model dropdown without making you type tag names blind. | login when OIDC on |

### Runtime settings

Some knobs (currently just the LLM provider / model name) are stored in
a DB-backed `app_settings` table rather than only in env vars. This
lets the operator change them from the UI without restarting the
container:

1. Open the Drawer → click "change" under the LLM chip.
2. Pick a provider, then a model. The model dropdown is populated from
   `/api/llm/tags?provider=ollama_cloud` (or `ollama` for local) — the
   actual models your account has access to, not a guess.
3. Hit Save. The chip flips to the new model immediately and the next
   Brief uses it.

**Read precedence** (per lookup):

1. The `app_settings` row (if present and non-empty).
2. The env-var default (`OLLAMA_CLOUD_MODEL_BRIEF`, `BRIEF_WINDOW_HOURS`, etc.).
3. The hardcoded fallback.

**Available runtime knobs** (full list in `.env.example`):

- `llm.provider` — picked via the chip; no env default.
- `llm.model_brief` / `llm.model_scoring` — model names for brief + scoring. Default `OLLAMA_CLOUD_MODEL_BRIEF` / `OLLAMA_CLOUD_MODEL_SCORING`.
- `brief.window_hours` — lookback window for the brief generator. Filters on `fetched_at` (when the row landed in the DB), not `published_at`, so historical content (Wikipedia "on this day") ingested today doesn't pollute today's digest. Default 24, clamped to `[1, 168]`.

**Env vs DB.** On first boot, `seed_from_env` copies the relevant env
values into the table — but only if the table is empty for that key.
After that, the table is authoritative: an `.env` edit does NOT
silently override the choice you made in the UI. To reset a value to
"use env," set it to the empty string in the picker.

### Phase 3 — sources

Six source plugins, all anonymous (no API keys required for the core
set), all bot-tolerant. Categories:

| Source                  | Category | Refresh | Notes |
| ----------------------- | -------- | ------- | ----- |
| BBC News                | `news`   | 1 h     | RSS; phase 3 fixed the User-Agent and switched to https |
| Wikipedia On This Day   | `news`   | 12 h    | REST; today's historical events + curated anniversaries |
| Hacker News top         | `tech`   | 5 min   | Firebase API; top 30 stories, score + comment count in meta |
| GitHub releases         | `tech`   | 30 min  | 5 repos (python/cpython, nodejs/node, kubernetes/*, rust-lang/rust); ETag-cached |
| NVD recent CVEs         | `vulns`  | 6 h     | NIST CVE 2.0 API; 7-day rolling window of published CVEs |
| CISA KEV                | `vulns`  | 6 h     | Known Exploited Vulnerabilities catalog; dateAdded as the published_at |

The scheduler runs an immediate fetch per source on startup, so the
dashboard populates within ~30 seconds of the first boot. Each source
ingests independently — a GitHub rate-limit or NVD maintenance window
won't block the others.

To add a repo to the GitHub source, edit `backend/app/sources/github_releases.py`
and add to `_DEFAULT_REPOS`. To add an authenticated token for higher
rate limits, set `GITHUB_TOKEN` in `.env`.

**BBC fix.** Phase 1's RSS fetcher sent `User-Agent: popping/0.1` over
`http://`. Several RSS providers (BBC since 2024, Reddit, etc.) throttle
or 403 the default `python-httpx` UA. Phase 3 ships a descriptive UA
and an explicit `Accept: application/rss+xml, application/atom+xml, …`
header, which is enough to get past those filters without any
unconventional headers.

Sources intentionally deferred to a later phase: RedFlagDeals (rate-limit
sensitive), ESPN (sport-specific endpoints), Reddit / Mastodon
(privacy-policy noise), Podcast Index and Keepa (API keys +
tier-specific endpoints).

### Adding a YouTube channel

Settings → Feeds → Add, then either paste the link, `@handle` or
channel ID into Auto feed and tap Auto-add, or pick YouTube under Type
in the form below. Name is optional: Popping names the feed after the
handle (`mkbhd_yt`) or, for a video link, after the channel once Test
has looked it up. Popping turns what you paste into the channel's free
YouTube feed:

| You paste | What happens |
| --- | --- |
| The channel ID (starts with `UC`), a `/channel/UC…` link, the feed link (`feeds/videos.xml?channel_id=…`), or a channel's uploads playlist (`list=UU…`) | Used directly. No lookup. |
| A public playlist link (`list=PL…`) | Follows that playlist. No lookup. |
| An `@handle`, a `/c/name` or `/user/name` link, a video link (`watch?v=`, `youtu.be`, `/shorts/`, `/live/`), or an old `youtube.com/name` link | Popping opens that one YouTube page and reads the channel ID from it. |
| Watch later, Liked videos, mixes, the home page, search results | Refused with a message: they have no feed. |

YouTube sometimes answers a server with a consent page or a "confirm
you're not a bot" check instead of the channel page. Popping then says
so and asks for the channel ID. In the YouTube app: open the channel,
tap "more about this channel", then Share channel, then Copy channel
ID, and paste that.

Each lookup writes one log line, without the link's query string:

```bash
cd /opt/popping && docker compose logs backend | grep "youtube: lookup"
```

`result=` names the page marker that worked (`canonical`, `rss_link`,
`channel_id`, …) or why it failed: `blocked:consent` or `blocked:bot`
(YouTube refused the server), `not_found`, `http_<code>`, `network`,
`blocked:ssrf` or `blocked:host` (the link led somewhere Popping won't
go).

## Adding a new source plugin

1. Create `backend/app/sources/<name>.py`:

   ```python
   from app.sources import register_source
   from app.sources.base import SourcePlugin

   @register_source
   class MySource(SourcePlugin):
       name = "my_source"             # unique
       type = "rss"                   # rss | api | scrape
       category = "news"              # news | deals | vulns | ...
       url = "https://example.com/feed.xml"
       refresh_interval_seconds = 3600

       async def fetch(self) -> list[dict]:
           # Return [{title, url, published_at, ...extras}, ...]
           ...
   ```

2. Add the import to the bottom of `backend/app/sources/__init__.py`:

   ```python
   from app.sources import rss, my_source  # noqa: F401, E402
   ```

3. Restart the backend container. The scheduler picks up the new plugin on next boot; the sources row is auto-upserted on first fetch.

## Phase 2 — scoring, embeddings, For You

Phase 1's `composite_score` was just recency. Phase 2 makes the feed
actually intelligent:

- **Composite scoring** blends recency, source weight, and personal
  preference (vector cosine + followed/muted categories). The blend
  weights are env-tunable (`SCORING_WEIGHT_*`).
- **Embedding pipeline** fills `entries.embedding` with 384-dim
  sentence-transformers vectors at ingest time. One-shot backfill
  on startup handles entries from before the column was wired in.
- **LLM provider abstraction** (Ollama / Anthropic / OpenAI / Groq) is
  in place but currently unused — phase 4's Brief generator will be
  the first call site.
- **For You** (`GET /api/foryou`) is a personal top-N feed with a
  convergence boost: items sharing a normalized title across multiple
  sources within 24h get a small multiplicative bump.

### Scoring math

```
composite = w_recency * recency(published_at, category)
          + w_personal * personal(entry, source, profile)
          + w_source   * (raw_score * source_weight)

personal = vector_score * category_multiplier(followed, muted)
```

`recency` is exponential decay with per-category half-life (news/vulns:
6 h, deals: 48 h, sports: 3 h, default: 12 h). `vector_score` is cosine
similarity to the user's `preference_vector`, rescaled from `[-1, 1]` to
`[0, 100]`. NULL vectors return a neutral 50 (cold-start midpoint).

`preference_vector` itself is populated from interactions, not just
category follows — `app.scheduler._recompute_preference_vector` (a
`pref_vector_recompute_interval_minutes`-minute tick, default 10)
aggregates each interaction's *entry embedding*, weighted by type
(thumb_up/bookmark pull toward, thumb_down/never push away), into the
vector. So a hide or a read acts on that specific card's content, not
just its source or category — `_rescore_recent_entries` (a separate,
more frequent tick) then re-applies the updated vector to already-
ingested entries. Both are batch, not real-time: an interaction takes
up to one tick to visibly move the feed.

### Convergence boost

Computed at query time, not at ingest, so clusters pick up the boost
the moment they form. One SQL `GROUP BY title_slug` over the last
`CONVERGENCE_WINDOW_HOURS`, then a Python pass applies the multiplier:

- 1 source → ×1.0 (no boost)
- 2 sources → ×`CONVERGENCE_BOOST_2` (default 1.10)
- 3+ sources → ×`CONVERGENCE_BOOST_3PLUS` (default 1.20)

### Embedding backfill

On startup the scheduler queues a one-shot job (and re-runs it every
5 minutes as a safety net) that embeds any entry with a NULL embedding.
Batches of `EMBEDDING_BATCH_SIZE` (default 64). Failures are logged and
skipped — the entry stays in the table with NULL embedding, and
`personal.score` treats that as a neutral 50 cosine.

### Provider selection

The LLM router picks the first configured provider in this order:
Anthropic → OpenAI → Groq → Ollama. If nothing is configured,
`provider_for(task)` returns `None` and callers log-and-skip. Phase 2
has no call sites yet, so a no-key install is fully supported.

### Memory note

`sentence-transformers` pulls in torch (~200 MB CPU-only, ~600 MB
CUDA). The Dockerfile installs CPU-only torch explicitly to keep the
image slim. Set `EMBEDDING_ENABLED=false` to skip the whole pipeline
on a memory-constrained host; the rest of the scoring still works,
just without the vector signal.

## Layout

```
.
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/
│   │       ├── 0001_initial.py
│   │       └── 0002_auth.py   # sessions table
│   └── app/
│       ├── main.py            # FastAPI app + lifespan
│       ├── config.py          # pydantic-settings
│       ├── db.py              # async SQLAlchemy engine
│       ├── deps.py
│       ├── auth/              # OIDC + local auth (mounted when OIDC_ENABLED=true)
│       │   ├── settings.py    #   OIDCConfig loader
│       │   ├── session.py     #   DB-backed sessions
│       │   ├── oidc.py        #   authlib PKCE flow
│       │   ├── deps.py        #   current_user / require_user (incl. local bypass)
│       │   ├── routes.py      #   /auth/login /auth/callback /auth/logout /auth/me
│       │   └── local.py       #   POST /auth/local (bcrypt fallback user)
│       ├── models.py          # SQLAlchemy ORM (sources/entries/interactions/...)
│       ├── schemas.py         # Pydantic response shapes
│       ├── scheduler.py       # APScheduler + ingest pipeline (incl. embed backfill)
│       ├── embeddings.py      # sentence-transformers singleton
│       ├── llm/               # provider abstraction (Anthropic / OpenAI / Groq / Ollama)
│       ├── scoring/           # recency (per-category) + source + personal + composite
│       ├── sources/
│       │   ├── base.py            # SourcePlugin ABC
│       │   ├── rss.py             # BBC News (phase 1; phase 3: UA + https fix)
│       │   ├── hn.py              # Hacker News top stories
│       │   ├── github_releases.py # GitHub releases (5 repos, ETag-cached)
│       │   ├── nvd.py             # NVD recent CVEs (7-day rolling)
│       │   ├── cisa_kev.py        # CISA Known Exploited Vulnerabilities
│       │   ├── wikipedia_on_this_day.py  # Wikipedia On This Day events
│       │   └── __init__.py        # @register_source + plugin discovery
│       └── routes/
│           ├── health.py
│           ├── sources.py
│           ├── entries.py
│           ├── foryou.py      # /api/foryou — personal top-N
│           └── ingest.py
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    └── src/
        ├── App.tsx            # desktop grid + mobile swipe
        ├── api.ts
        └── components/
            ├── Card.tsx
            ├── Column.tsx
            ├── Drawer.tsx
            ├── Hamburger.tsx
            ├── LoginPage.tsx   # shown when OIDC is on and user is logged out
            └── UserBadge.tsx   # name + sign-out chip in the header
```

## Phase roadmap

- **Phase 1**: scaffold, schema, one RSS source, minimal UI. ✅
- **Phase 2**: composite scoring engine, sentence-transformers embeddings,
  LLM provider abstraction, For You feed with convergence boost. ✅
- **Phase 3**: six source plugins — BBC, Wikipedia On This Day, Hacker
  News, GitHub releases (5 repos), NVD CVEs, CISA KEV. BBC RSS fetcher
  fixed (proper User-Agent + https). New `tech` and `vulns` categories.
  ✅
- **Phase 4**: The Brief generator (daily + manual + convergence
  triggers), notifications via Apprise (preferred) / Pushover (fallback),
  alert paths for high-CVSS CVEs and convergence clusters. ✅
- **Phase 5**: user-managed feeds — add/edit/delete dynamic RSS and
  Reddit sources from the UI, per-source custom headers, a Test-before-Add
  fetch check, and a preference-vector-ranked Recommended tab. ✅
- **Phase 6**: podcast sources (`type="podcast"`) — reuses the RSS fetch
  path since podcast feeds are RSS-shaped; extracts the episode audio
  file and duration from the `<enclosure>` / `<itunes:duration>` tags.
  The card renders a "🎧 Listen" link when an entry has one. ✅

## Environment variables

All optional except the database credentials (defaults work). See `.env.example` for the full list. In production nginx proxies to `BACKEND_URL` (set in `docker-compose.yml`); in dev, `VITE_BACKEND_URL` points Vite's dev-server proxy at the backend.

## Development notes

- **Hot reload**: both backend (`uvicorn --reload`) and frontend (Vite HMR) reload on file changes via the bind mounts in `docker-compose.yml`.
- **Schema changes**: edit `app/models.py`, then `docker compose exec backend alembic revision --autogenerate -m "..."`. Commit the new file in `alembic/versions/`.
- **Reset**: `docker compose down -v` wipes the postgres volume. Next `up` re-runs migrations from scratch.
- **Dependencies**: Python packages are pinned in `backend/requirements.lock` (runtime) and `backend/requirements-dev.lock` (adds test tools). After editing `pyproject.toml`, run `backend/scripts/lock.sh` (needs [uv](https://docs.astral.sh/uv/)). torch is installed separately as the CPU build; its version is `TORCH_VERSION` in `backend/Dockerfile`.
- **Upgrading from an older image**: the backend now runs as uid 10001. If an existing `assets` volume was created by an older root-run image, fix its ownership once: `docker compose run --rm --user root backend chown -R 10001:10001 /app/assets`.
