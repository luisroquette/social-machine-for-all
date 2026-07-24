#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.local"

if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

BASE_URL="${APP_BASE_URL:-http://localhost:3000}"

if [ -z "${CRON_SECRET:-}" ]; then
  echo "CRON_SECRET nao configurado."
  exit 1
fi

echo "== trend-discovery-br =="
curl -s "${BASE_URL}/api/cron/trend-discovery-br" \
  -H "Authorization: Bearer ${CRON_SECRET}"
echo
echo

echo "== trend-creative-prepare =="
curl -s "${BASE_URL}/api/cron/trend-creative-prepare" \
  -H "Authorization: Bearer ${CRON_SECRET}"
echo
echo

echo "== trend-video-animate =="
curl -s "${BASE_URL}/api/cron/trend-video-animate" \
  -H "Authorization: Bearer ${CRON_SECRET}"
echo
echo

echo "== trend-video-publish =="
curl -s "${BASE_URL}/api/cron/trend-video-publish" \
  -H "Authorization: Bearer ${CRON_SECRET}"
echo
