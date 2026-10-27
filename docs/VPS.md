# The VPS

How Popping is laid out on its server, written so another app can be
planned for the same box. It comes from this repo (`docker-compose.yml`,
`ops/`, `.env.example`, `egress-proxy/`, the backend's network code)
plus two facts from the owner: the server is a **RackNerd VPS**, and it
is reached over **Tailscale**. What the repo can't show is listed under
[Not confirmed](#not-confirmed) with the command that answers it.

## At a glance

| | |
| --- | --- |
| Host | RackNerd VPS. OS, size and timezone not recorded here |
| Access | Tailscale. No port is meant to be open to the internet |
| Runtime | Docker + Docker Compose v2, one compose project named `popping` |
| Install dir | `/opt/popping`, a git checkout of this repo plus a local `.env` |
| Images | `ghcr.io/adamjmachill/popping-{backend,frontend}:latest`, built by GitHub Actions on every push to `main` |
| Published ports | One: `127.0.0.1:14789` → frontend nginx `:8080` |
| Data | Three named Docker volumes: `popping_pgdata`, `popping_assets`, `popping_models` |
| Backups | Nightly `pg_dump` + `.env` copy to `/root/backups`, kept 14 days, same disk |
| Updates | Manual: `popping-update` |

## Files on the host

```
/opt/popping/                    git checkout of this repo, tracked files never edited
├── .env                         the only local file: settings and secrets (gitignored)
├── docker-compose.yml           what runs
├── ops/                         sources of the two helper scripts below
└── egress-proxy/                built on the box only when the "hardened" profile is on

/usr/local/bin/popping-update    copy of ops/popping-update.sh  (root, 700)
/usr/local/bin/popping-backup    copy of ops/popping-backup.sh  (root, 700)
/etc/cron.d/popping-backup       30 10 * * * root /usr/local/bin/popping-backup >> /var/log/popping-backup.log 2>&1
/var/log/popping-backup.log
/root/backups/                   popping-YYYYMMDD-HHMM.dump and env-YYYYMMDD-HHMM (umask 077)

/var/lib/docker/volumes/
├── popping_pgdata               Postgres 16 data directory
├── popping_assets               cached favicons and thumbnails (rebuilt on demand)
└── popping_models               embedding model download (re-downloaded if lost)
```

Never edit tracked files in `/opt/popping`: `popping-update` runs
`git pull --ff-only`, which refuses on a dirty tree and stops every
later update. Never pin `POPPING_IMAGE_TAG` in `.env` either; a pin
silently stops updates.

## Containers

Compose project `popping`, so containers are named `popping-<service>-1`
and share the network `popping_default`.

| Service | Image | Listens on | Published | Memory cap | Runs when |
| --- | --- | --- | --- | --- | --- |
| `postgres` | `pgvector/pgvector:0.8.1-pg16` | 5432 | no | 768m | always |
| `backend` | `ghcr.io/adamjmachill/popping-backend:latest` | 8000 | no | 2g | always |
| `frontend` | `ghcr.io/adamjmachill/popping-frontend:latest` | 8080 | `127.0.0.1:14789` | 128m | always |
| `guard-proxy` | built from `./egress-proxy` (Squid) | 3128 | no | none | only with `COMPOSE_PROFILES=hardened` |
| `cloudflared` | `cloudflare/cloudflared:2026.9.1` | outbound only | no | 128m | only with `COMPOSE_PROFILES=tunnel` |

All of them:

- `restart: unless-stopped`, so they come back after a reboot once Docker starts.
- Logs go to `json-file`, capped at 10 MB × 3 files per container.

Per service:

- **postgres**: credentials come from `POSTGRES_*` in `.env`. Health check is `pg_isready` every 10 s.
- **backend**: FastAPI under uvicorn, one worker only (see `ARCHITECTURE.md`), running as uid 10001.
  - Runs `alembic upgrade head` on every start.
  - Health check is `GET /api/health` every 30 s, with a 120 s start period.
  - `host.docker.internal` maps to the host gateway, for an Ollama on the host at `:11434`.
- **frontend**: unprivileged nginx serving the built app. It proxies `/api`, `/assets` and `/auth` to `http://backend:8000`, with a 300 s read timeout for Brief generation.

The memory caps add up to about 2.9 GB (3.0 GB with `cloudflared`).
The compose file is sized for a 4 GB host.

## Traffic

```
 phone / laptop
      │  Tailscale
      ▼
 VPS ─ 127.0.0.1:14789 (or the tailnet address, see Not confirmed)
      │
      ▼  docker network popping_default
 frontend :8080 ── /api /assets /auth ──▶ backend :8000 ──▶ postgres :5432
                                              │
                                              ├──▶ internet: feeds, articles, podcasts, YouTube,
                                              │    Reddit .rss, LLM APIs (via guard-proxy :3128
                                              │    when "hardened" is on)
                                              └──▶ host.docker.internal:11434 (Ollama, if any)
```

- **Inbound:** only the frontend port. Docker writes its own iptables
  rules, which bypass `ufw`, so binding a container to `0.0.0.0` makes it
  public whatever `ufw` says. Popping has no login unless OIDC is on,
  so it stays on `127.0.0.1`.
- **Outbound:** the backend polls feeds around the clock from the VPS's
  public IP. Unless `REDDIT_HYDRA_URL` is set, Reddit is read directly at
  one call per 75 s; Reddit's anonymous limit is about 60 calls an hour per IP,
  and another app on the box would share it.
- **SSRF guard:** the backend refuses to fetch any feed, favicon or
  thumbnail URL that resolves to a private address
  (`backend/app/url_safety.py`, and `egress-proxy/squid.conf` when
  hardened). That list includes `100.64.0.0/10`, the range Tailscale
  hands out, and Docker's `172.16.0.0/12`.

## Deploys and timed jobs

1. A push to `main` runs `.github/workflows/build.yml`, which tests, builds and pushes both images to GHCR as `latest`, `main` and `sha-<40-char sha>`. PR builds never publish.
2. On the box, `popping-update` runs these steps:
   1. `git pull --ff-only`
   2. `docker compose pull`
   3. `docker compose up -d`
   4. `docker image prune -f`, which removes dangling images host-wide
   5. Waits up to 3 minutes for the backend to report healthy, then prints `docker compose ps` and disk use.
3. To roll back the frontend only: `cd /opt/popping && POPPING_IMAGE_TAG=sha-<last good> docker compose up -d --no-deps frontend`. The last good sha is kept in `docs/DEVICE_CHECKS.md`. Backend rollbacks that cross a migration follow `docs/ux-notes/PR9a.md`.

| When | What | Where |
| --- | --- | --- |
| 10:30 daily, server timezone | `popping-backup`: `pg_dump -Fc` and a copy of `.env` | `/etc/cron.d/popping-backup` |
| 08:00 UTC daily | Brief generation (one LLM call; pushed if notifications are set up) | In the backend (`BRIEF_SCHEDULE_HOUR`) |
| Continuously | Feed polling, embeddings, rescoring, convergence check every 15 min | In the backend (APScheduler) |

Restoring a dump:
`cd /opt/popping && docker compose exec -T postgres sh -c 'pg_restore --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < /root/backups/popping-XXXX.dump`.
The backups sit on the VPS's own disk, so losing the VPS loses them too.

## Not confirmed

The repo doesn't record these. Running this on the box answers all of
them, and it prints no secrets:

```bash
cat /etc/os-release | head -2; timedatectl | grep 'Time zone'
nproc; free -h; df -h /
docker version --format 'docker {{.Server.Version}}'; docker compose version
tailscale ip -4; tailscale serve status; tailscale funnel status
grep -E '^(COMPOSE_PROFILES|POPPING_FRONTEND_HOST|POPPING_FRONTEND_PORT|PUBLIC_URL|OIDC_ENABLED|HTTP_PROXY|REDDIT_HYDRA_URL|OLLAMA_BASE_URL|EMBEDDING_ENABLED)=' /opt/popping/.env
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
ss -tlnp
ufw status verbose
ls /opt /etc/cron.d; crontab -l
curl -s -m 2 http://127.0.0.1:11434/api/tags >/dev/null && echo "ollama on host" || echo "no ollama on host"
```

What each one settles:

- **How Tailscale reaches the app.** With the default bind
  (`127.0.0.1:14789`), there are two ways a tailnet device gets in:
  `tailscale serve` in front of that port (HTTPS on the machine's
  `*.ts.net` name), or `POPPING_FRONTEND_HOST` set to the box's
  `100.x` address. `tailscale serve status` and the `.env` grep show
  which one is in use.
- **Whether anything else is exposed.** `ss -tlnp` lists every listener.
  Anything on `0.0.0.0` or the public IP other than SSH is worth
  knowing about. If the VPS's public SSH is closed and SSH only
  answers on Tailscale, record that here too.
- **Profiles and LLM.** `COMPOSE_PROFILES` shows whether `tunnel`
  and `hardened` are on. `OLLAMA_BASE_URL` and the Ollama probe show
  whether the LLM is local or a cloud provider. The `.env.example`
  defaults point to Ollama Cloud.
- **Leftovers.** Code comments mention an earlier home deployment on
  a TrueNAS box, and a separate Reddit proxy ("Hydra") at
  `/opt/popping-proxy` on a VPS. `ls /opt` shows whether that proxy
  lives on this box.

## Putting another app on this box

- **Directory and project.** Put it in `/opt/<name>` with its own
  compose file and its own `name:`, so it gets its own containers,
  network and volumes. Don't add services to `/opt/popping`.
- **Ports.** Publish on `127.0.0.1` (or the tailnet address), never
  `0.0.0.0`. `14789` is taken; pick another unused port, and check it
  with `ss -tlnp`.
- **Access.** Reach it the same way as Popping, through Tailscale. With
  `tailscale serve`, each app gets its own port or path on the
  machine's `ts.net` name.
- **Memory.** Popping's caps already total about 2.9 GB. Check
  `free -h`, and give every new service a `mem_limit` so one app can't
  starve the other.
- **Disk.** Copy Popping's `x-logging` anchor (10 MB × 3) and prune old
  images after updates. Each Popping update pulls 1–2 GB of images.
- **Database.** Popping's Postgres has no published port and lives on
  `popping_default`. Give the new app its own database container
  rather than sharing it.
- **Backups.** `popping-backup` covers only Popping's database and
  `.env`. Add a second script and cron entry at a different time from
  10:30. Copying both apps' backups off the box would close the
  same-disk gap.
- **Talking to Popping.** Another container can join `popping_default`
  as an external network and call `http://backend:8000/api/...`. Reads
  are public; changes need a session once OIDC is on.
- **Popping reading the new app.** If Popping should read the new app
  as a feed, the feed URL must resolve to a public IP. Its SSRF guard
  refuses tailnet, Docker and loopback addresses, and there is no
  allowlist for feeds.
- **Shared IP.** Both apps share the VPS's public IP, so its rate
  limits are shared too (Reddit's above all). Anything the new app
  scrapes counts against the same reputation.
