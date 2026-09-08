#!/usr/bin/env bash
# ============================================================================
# AION platform — Cloud Agent start (per-boot service reconciliation).
# ----------------------------------------------------------------------------
# Idempotent. Runs on every boot and must return:
#   1. start PostgreSQL 16
#   2. ensure the two-role model (aion_migrator / aion_app) + databases
#   3. apply migrations + catalog seeds + least-privilege grants (migrate job)
#   4. boot the aion-runtime host (Core over Data) and wait for readiness
# The long-running host is launched detached; heavy dependency install lives in
# install.sh, never here.
# ============================================================================
set -euo pipefail

REPOS="${AION_REPOS_ROOT:-/agent/repos}"
PORT="${PORT:-8080}"
MIGRATION_DATABASE_URL="postgresql://aion_migrator:migrator@127.0.0.1:5432/aion_data"
DATABASE_URL="postgresql://aion_app:app@127.0.0.1:5432/aion_data"

NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/v*/bin 2>/dev/null | sort -V | tail -1 || true)"
if [ -n "$NODE_BIN" ]; then export PATH="$NODE_BIN:$PATH"; fi

# ── 1. Start PostgreSQL (idempotent) ────────────────────────────────────────
sudo pg_ctlcluster 16 main start 2>/dev/null || true
for _ in $(seq 1 30); do pg_isready -h 127.0.0.1 -p 5432 -q && break; sleep 1; done
pg_isready -h 127.0.0.1 -p 5432 -q || { echo "[start] postgres not ready"; exit 1; }

# ── 2. Roles + databases (idempotent) ───────────────────────────────────────
sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='aion_migrator') THEN
    CREATE ROLE aion_migrator LOGIN PASSWORD 'migrator';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='aion_app') THEN
    CREATE ROLE aion_app LOGIN PASSWORD 'app';
  END IF;
END $$;
SELECT 'CREATE DATABASE aion_data OWNER aion_migrator'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='aion_data')\gexec
SELECT 'CREATE DATABASE aion_data_test OWNER postgres'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='aion_data_test')\gexec
SQL
sudo -u postgres psql -v ON_ERROR_STOP=1 -d aion_data \
  -c "ALTER SCHEMA public OWNER TO aion_migrator;" \
  -c "GRANT ALL ON SCHEMA public TO aion_migrator;"

# ── 3. Migrate + seed catalogs + grants (idempotent migration job) ──────────
(
  cd "$REPOS/aion-runtime"
  MIGRATION_DATABASE_URL="$MIGRATION_DATABASE_URL" DATABASE_SSL=false node dist/migrate.js
)

# ── 4. Boot the runtime host (app role only), wait for readiness ────────────
if curl -sf "http://127.0.0.1:${PORT}/health/live" >/dev/null 2>&1; then
  echo "[start] aion-runtime already listening on :${PORT}"
else
  (
    cd "$REPOS/aion-runtime"
    env -u MIGRATION_DATABASE_URL \
      DATABASE_URL="$DATABASE_URL" AION_ENVIRONMENT=local DATABASE_SSL=false \
      PORT="$PORT" GIT_SHA="${GIT_SHA:-local}" SERVICE_VERSION=0.1.0 \
      RUN_SMOKE_ON_BOOT=true \
      setsid nohup node dist/index.js >/tmp/aion-runtime.log 2>&1 &
  )
  for _ in $(seq 1 40); do
    sleep 0.5
    curl -sf "http://127.0.0.1:${PORT}/health/ready" >/dev/null 2>&1 && break
  done
fi

if ! curl -sf "http://127.0.0.1:${PORT}/health/ready" >/dev/null 2>&1; then
  echo "[start] aion-runtime failed readiness"; cat /tmp/aion-runtime.log 2>/dev/null || true; exit 1
fi
echo "[start] AION platform ready — runtime host on :${PORT} (GET /health/ready = 200)"
