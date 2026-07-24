#!/usr/bin/env sh
set -eu

fail=0

report() {
  printf '%s\n' "public-release audit: $1" >&2
  fail=1
}

tracked="$(git ls-files)"

if printf '%s\n' "$tracked" | grep -E '(^|/)\.env($|\.)' | grep -vE '(^|/)\.env\.example$' >/dev/null; then
  report 'environment file is tracked'
fi

if printf '%s\n' "$tracked" | grep -E '(^|/)(\.vercel|supabase/\.temp|node_modules|\.next)(/|$)' >/dev/null; then
  report 'local infrastructure artifact is tracked'
fi

if printf '%s\n' "$tracked" | grep -Ei '\.(pem|p8|p12|pfx|key)$|(^|/)(service-account|credentials).*\.json$' >/dev/null; then
  report 'credential-like file is tracked'
fi

if git grep -nEI -- ':!package-lock.json' \
  '(-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,})' >/dev/null; then
  report 'possible secret found in tracked content'
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi

printf '%s\n' 'public-release audit: passed'
