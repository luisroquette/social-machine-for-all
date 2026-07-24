#!/bin/sh
# session-audit.sh — Detecta fix: commits sem record-fix correspondente no soul dos agentes.
#
# Uso:
#   ./scripts/session-audit.sh           # últimos 60 dias
#   ./scripts/session-audit.sh 30        # últimos N dias
#   npm run session-audit
#
# Requer: curl, jq (brew install jq)

DAYS="${1:-60}"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  echo "Erro: rode dentro do repositório social-machine-v3.1."
  exit 1
fi

ENV_FILE="$REPO_ROOT/.env.production"
if [ ! -f "$ENV_FILE" ]; then
  echo "Erro: .env.production não encontrado em $REPO_ROOT."
  exit 1
fi

# Lê variáveis de ambiente
SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' "$ENV_FILE" | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" | sed 's/\\n$//')
SERVICE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' "$ENV_FILE" | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" | sed 's/\\n$//')
CRON_SECRET=$(grep '^CRON_SECRET=' "$ENV_FILE" | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'")
APP_BASE_URL=$(grep '^APP_BASE_URL=' "$ENV_FILE" | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" | sed 's/\\n$//')

if [ -z "$SUPABASE_URL" ] || [ -z "$SERVICE_KEY" ]; then
  echo "Erro: NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente."
  exit 1
fi

echo ""
echo "┌─────────────────────────────────────────────────────────┐"
echo "│  Social Machine V3.1 — Session Audit                    │"
echo "│  Fix commits vs. soul dos agentes (últimos ${DAYS} dias)      │"
echo "└─────────────────────────────────────────────────────────┘"
echo ""

# ── Passo 1: Fix commits no git log ──
echo "📋 Fix commits (últimos ${DAYS} dias):"
SINCE_DATE=$(date -v-"${DAYS}"d +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -d "${DAYS} days ago" +%Y-%m-%dT%H:%M:%S 2>/dev/null)

FIX_COMMITS=$(git -C "$REPO_ROOT" log \
  --since="$SINCE_DATE" \
  --pretty=format:"%H|%ai|%s" \
  --all | grep -E '\|(fix:|bugfix:|hotfix:|fix\()' || true)

if [ -z "$FIX_COMMITS" ]; then
  echo "  Nenhum fix commit encontrado nos últimos ${DAYS} dias."
else
  echo "$FIX_COMMITS" | while IFS='|' read -r hash date subject; do
    SHORT=$(echo "$hash" | cut -c1-8)
    echo "  ${SHORT} $(echo "$date" | cut -c1-10)  $subject"
  done
fi
echo ""

# ── Passo 2: Fixes registrados no soul (agent_memories) ──
echo "🧠 Fixes registrados no soul (últimos ${DAYS} dias):"
SINCE_ISO=$(date -v-"${DAYS}"d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -d "${DAYS} days ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)

MEMORIES_RESPONSE=$(curl -s \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  "${SUPABASE_URL}/rest/v1/agent_memories?select=id,agent_slug,content,context,created_at&context->>_source=in.(claude-code-deploy,pre-push-hook)&created_at=gte.${SINCE_ISO}&order=created_at.desc&limit=50")

if ! echo "$MEMORIES_RESPONSE" | grep -q '\['; then
  echo "  ⚠  Falha ao consultar Supabase. Tabela agent_memories pode não existir ainda."
  echo "  Resposta: $(echo "$MEMORIES_RESPONSE" | head -c 200)"
else
  COUNT=$(echo "$MEMORIES_RESPONSE" | python3 -c "import json,sys; data=json.load(sys.stdin); print(len(data))" 2>/dev/null || echo "?")
  if [ "$COUNT" = "0" ] || [ -z "$COUNT" ]; then
    echo "  Nenhum fix registrado no soul nos últimos ${DAYS} dias."
  else
    # Deduplica por conteúdo (só mostra uma vez por fix, não por agente)
    echo "$MEMORIES_RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
seen = set()
for m in data:
    content = m.get('content','')[:80]
    date = m.get('created_at','')[:10]
    src = (m.get('context') or {}).get('_source','?')
    key = content[:40]
    if key not in seen:
        seen.add(key)
        print(f'  {date}  [{src}]  {content}')
" 2>/dev/null || echo "  (instale python3 para detalhes)"
  fi
fi
echo ""

# ── Passo 3: Cross-check — commits sem registro ──
if [ -n "$FIX_COMMITS" ] && echo "$MEMORIES_RESPONSE" | grep -q '\['; then
  echo "⚠️  Cross-check (fix commits sem registro detectável):"
  GAP_FILE=$(mktemp)
  echo "$FIX_COMMITS" | while IFS='|' read -r hash date subject; do
    SHORT_MSG=$(echo "$subject" | sed 's/^fix: //' | sed 's/^fix([^)]*): //' | cut -c1-40)
    MATCH=$(echo "$MEMORIES_RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
commit = '$hash'
msg = '$SHORT_MSG'.lower()
for m in data:
    ctx = m.get('context') or {}
    if ctx.get('commit','').startswith(commit[:7]):
        print('FOUND')
        break
    if msg and msg[:20] in m.get('content','').lower():
        print('FOUND')
        break
" 2>/dev/null)
    if [ "$MATCH" != "FOUND" ]; then
      SHORT=$(echo "$hash" | cut -c1-8)
      echo "  ❌ ${SHORT}  $subject"
      echo "GAP" >> "$GAP_FILE"
    fi
  done
  if [ ! -s "$GAP_FILE" ]; then
    echo "  ✅ Todos os fix commits têm registro no soul."
  fi
  rm -f "$GAP_FILE"
fi

echo ""
echo "─────────────────────────────────────────────────────────────"
echo "💡 Para registrar um fix manualmente:"
echo "   curl -X POST ${APP_BASE_URL}/api/infra/record-fix \\"
echo "     -H 'Authorization: Bearer \$CRON_SECRET' \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"agents\":[\"*\"],\"summary\":\"Descrição do fix\",\"root_cause\":\"Causa raiz\"}'"
echo ""
