#!/usr/bin/env bash
# ============================================================================
# AION platform — Cloud Agent install (idempotent repository bootstrap).
# ----------------------------------------------------------------------------
# Runs from the workspace root after checkout. Prepares every buildable repo in
# the AION constitution so the platform can boot and every dev loop works:
#   aion-core   → kernel (library)
#   aion-data   → durable Postgres layer (vendors core, builds)
#   aion-runtime→ composition root / HTTP gateway (vendors core+data, builds)
#   aion-desks  → Next.js product
#   aion-products → revenue copilot (vendors core)
# System PostgreSQL 16 is installed here only if missing (the snapshot normally
# already carries it). No servers are started here — see start.sh.
# ============================================================================
set -euo pipefail

REPOS="${AION_REPOS_ROOT:-/agent/repos}"

# Prefer the newest nvm-managed Node (aion-products requires Node >= 22.18).
NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/v*/bin 2>/dev/null | sort -V | tail -1 || true)"
if [ -n "$NODE_BIN" ]; then export PATH="$NODE_BIN:$PATH"; fi
echo "[install] node $(node -v) / npm $(npm -v)"

# ── 1. System dependency: PostgreSQL 16 (idempotent) ────────────────────────
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  echo "[install] installing PostgreSQL 16 …"
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-client
else
  echo "[install] PostgreSQL present: $(psql --version)"
fi

# ── 2. aion-core (kernel) ───────────────────────────────────────────────────
echo "[install] aion-core"
( cd "$REPOS/aion-core" && npm ci && npm run build )

# ── 3. aion-data (durable Postgres layer; preinstall vendors core) ──────────
echo "[install] aion-data"
( cd "$REPOS/aion-data" && npm install --no-audit --no-fund --loglevel=error && npm run build )

# Turnkey local dev env for aion-data (LOCAL throwaway creds only; .env is gitignored).
if [ ! -f "$REPOS/aion-data/.env" ]; then
  cat > "$REPOS/aion-data/.env" <<'ENV'
DATABASE_URL=postgresql://aion_app:app@127.0.0.1:5432/aion_data
MIGRATION_DATABASE_URL=postgresql://aion_migrator:migrator@127.0.0.1:5432/aion_data
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/aion_data_test
ENV
  echo "[install] wrote aion-data/.env (local dev defaults)"
fi

# ── 4. aion-runtime (composition root; vendors core+data) ───────────────────
echo "[install] aion-runtime"
(
  cd "$REPOS/aion-runtime"
  npm run setup:deps
  npm install --no-audit --no-fund --loglevel=error
  npm run build
  # migrate.js reads grants from dist/sql/grants.sql (build does not copy it).
  mkdir -p dist/sql && cp sql/grants.sql dist/sql/grants.sql
)

# ── 5. aion-desks (Next.js product) ─────────────────────────────────────────
echo "[install] aion-desks"
( cd "$REPOS/aion-desks" && npm ci --no-audit --no-fund --loglevel=error )

# ── 6. aion-products (revenue copilot; vendors core) ────────────────────────
echo "[install] aion-products"
( cd "$REPOS/aion-products" && npm run setup:core && npm install --no-audit --no-fund --loglevel=error )

echo "[install] all repos ready"
