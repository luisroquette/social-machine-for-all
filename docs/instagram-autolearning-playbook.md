# Playbook: Sistema de Auto-Aprendizado para Perfis Instagram Autônomos

> **Para o agente do projeto:** este documento descreve o sistema completo de auto-aprendizado
> construído no Social Machine V3.1. Use-o como roteiro para replicar o sistema em qualquer
> novo perfil. Preencha os placeholders da Seção 1 antes de começar.

---

## 1. Placeholders — PREENCHA PRIMEIRO

| Placeholder | O que é | Exemplo |
|---|---|---|
| `{{PROFILE_NAME}}` | Nome do perfil Instagram | `@your_ai_profile` |
| `{{WORKSPACE_ID}}` | UUID do workspace no Supabase | `00000000-0000-4000-8000-000000000000` |
| `{{IG_BUSINESS_ID}}` | Instagram Business Account ID | `17841400000000000` |
| `{{PAGE_ID}}` | ID da Página do Facebook conectada | `123456789012345` |
| `{{META_APP_ID}}` | ID do app Meta | `123456789012345` |
| `{{PAGE_ACCESS_TOKEN}}` | Token permanente da Página (expires_at=0) | `YOUR_PAGE_ACCESS_TOKEN` |
| `{{BRAND_NAME}}` | Nome da marca/perfil | `Your Brand` |
| `{{BRAND_VOICE}}` | Tom de voz em 2-3 frases | "Direto, sem hype, dark humor" |
| `{{NICHE}}` | Nicho de conteúdo | `IA e tecnologia` |
| `{{SUPABASE_PROJECT}}` | Ref do projeto Supabase | `your-project-ref` |

---

## 2. O que o sistema faz (visão geral)

O sistema fecha um **loop de aprendizado contínuo**: publica reels → mede o desempenho real
(reach, watch time) → alimenta os agentes que criam o próximo conteúdo → o conteúdo melhora.

```
Publicação → Métricas reais → Aprendizado dos agentes → Curadoria melhor → Publicação
     ↑_______________________________________________________________|
```

Cinco camadas independentes, cada uma opcional:

| Camada | O que aprende | Onde impacta |
|---|---|---|
| **Métricas** | reach, watch time, engagement por reel | Base de dados para as demais |
| **Writer** | Quais ganchos (hooks) geram mais reach | Prompt do agente redator |
| **Reviewer** | Pesos das dimensões de qualidade | Scoring automático dos drafts |
| **Curator** | Quais autores-fonte rendem mais reach | Ranking de curadoria |
| **Autoreply** | — (reativo, não aprende) | Engajamento nos comentários |

---

## 3. Camada 1 — Captura de métricas

**O que faz:** após cada reel publicado, um cron diário chama a Graph API do Instagram e
armazena reach, watch time e engagement em colunas dedicadas (`engagement_score`,
`engagement_metrics`, `reach`) na tabela `generated_content`.

**Pré-requisito:** token com escopo `instagram_manage_insights`.

**Configurar para o novo perfil:**
1. Garantir que `{{PAGE_ACCESS_TOKEN}}` tem escopo `instagram_manage_insights`
   (verificar via `debug_token` na Graph API Explorer)
2. Salvar credenciais no workspace:
   ```sql
   UPDATE workspaces
   SET platform_credentials = jsonb_set(
     platform_credentials,
     '{instagram}',
     '{"pageAccessToken":"{{PAGE_ACCESS_TOKEN}}","igBusinessId":"{{IG_BUSINESS_ID}}",
       "pageId":"{{PAGE_ID}}","appId":"{{META_APP_ID}}"}'
   )
   WHERE id = '{{WORKSPACE_ID}}';
   ```
3. Fazer backfill dos reels históricos:
   ```bash
   curl -s "https://social-machine-v31.vercel.app/api/cron/reels-metrics?backfill=1" \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

**Validar:** após o próximo cron (21h UTC) ou backfill, rodar:
```sql
SELECT count(*) FILTER (WHERE reach IS NOT NULL) as com_reach,
       count(*) as total
FROM generated_content
WHERE workspace_id = '{{WORKSPACE_ID}}' AND target_format = 'reel';
```
Espera: `com_reach > 0`.

---

## 4. Camada 2 — Writer aprende com reach real

**O que faz:** ao gerar novos drafts, o Writer busca os 3 reels com maior reach do workspace
e injeta um bloco no prompt com:
- Os hooks (primeiras frases) que mais performaram
- Contraste de watch time: reels de alto reach vs baixo reach
- Padrão: "gancho X reteve X.Xs — retenção nos primeiros segundos = reach"

**Nenhuma configuração adicional:** funciona automaticamente para qualquer workspace com
`target_format = 'reel'` e `reach` populado.

**Calibrar:** ajustar o modelo do Writer via `workspace_settings`:
```sql
INSERT INTO workspace_settings (workspace_id, key, value)
VALUES ('{{WORKSPACE_ID}}', 'writer_model', 'claude-sonnet-4-6')
ON CONFLICT (workspace_id, key) DO UPDATE SET value = EXCLUDED.value;
```

---

## 5. Camada 3 — Reviewer com pesos configuráveis

**O que faz:** o Reviewer avalia cada draft em 6 dimensões com pesos que podem ser
ajustados por workspace via banco de dados:

| Dimensão | Default | Ajustar quando... |
|---|---|---|
| `hook` | 0.20 | Nicho onde o gancho é crítico (entretenimento, humor) → aumentar |
| `insight` | 0.20 | Nicho educacional/técnico → aumentar |
| `voice` | 0.20 | Marca com tom muito específico → aumentar |
| `size` | 0.15 | Plataforma com limites rígidos → aumentar |
| `identity` | 0.15 | Marca com identidade forte → aumentar |
| `politics` | 0.10 | Nicho sensível → aumentar |

**Calibrar para o perfil** (exemplo: nicho de entretenimento, gancho é tudo):
```sql
INSERT INTO workspace_settings (workspace_id, key, value) VALUES
('{{WORKSPACE_ID}}', 'reviewer_weight_hook', '0.35'),
('{{WORKSPACE_ID}}', 'reviewer_weight_insight', '0.15'),
('{{WORKSPACE_ID}}', 'reviewer_weight_voice', '0.20'),
('{{WORKSPACE_ID}}', 'reviewer_weight_size', '0.10'),
('{{WORKSPACE_ID}}', 'reviewer_weight_identity', '0.15'),
('{{WORKSPACE_ID}}', 'reviewer_weight_politics', '0.05')
ON CONFLICT (workspace_id, key) DO UPDATE SET value = EXCLUDED.value;
```
Os 6 valores devem somar 1.0.

**Threshold de aprovação** (default 7.0/10):
```sql
INSERT INTO workspace_settings (workspace_id, key, value)
VALUES ('{{WORKSPACE_ID}}', 'reviewer_approval_threshold', '7.5')
ON CONFLICT (workspace_id, key) DO UPDATE SET value = EXCLUDED.value;
```

---

## 6. Camada 4 — Curator aprende por autor-fonte

**O que faz:** após ~3 semanas com métricas populadas, o Curator calcula um multiplicador
de score por autor-fonte (`source_author` nos tweets curados):

- Autores cujo conteúdo gerou alto reach → score multiplicado (máx 1.6×)
- Autores de baixo reach → penalizados suavemente (mín 0.6×)
- Autores com < 3 reels publicados → neutros (1.0×)

**Nenhuma configuração adicional:** funciona automaticamente para qualquer workspace.

**Pré-requisito de dados:** mínimo ~15 reels publicados com `reach` populado para o sinal
fazer sentido. Antes disso, todos os autores ficam neutros e o Curator funciona normalmente.

**Validar após 3+ semanas:**
```sql
SELECT cc.source_author,
       count(*) as reels,
       round(avg(gc.reach)) as avg_reach
FROM generated_content gc
JOIN curated_content cc ON gc.curated_content_id = cc.id
WHERE gc.workspace_id = '{{WORKSPACE_ID}}'
  AND gc.target_format = 'reel'
  AND gc.reach IS NOT NULL
GROUP BY cc.source_author
ORDER BY avg_reach DESC LIMIT 10;
```

---

## 7. Camada 5 — Autoreply de comentários

**O que faz:** quando um seguidor comenta num post, o sistema:
1. Recebe o evento via webhook da Meta
2. Detecta se é comentário normal ou keyword CTA (≤2 palavras = keyword)
3. Gera resposta com IA no tom da marca
4. Posta como reply no próprio comentário

**Keyword CTA** (ex: "MINI", "INFO", "LINK"): responde pedindo follow + DM em vez de
tentar conversar. Exemplo: "Segue o perfil e me manda uma DM que envio pra você! 🤙"

**Configurar para novo perfil:**

### 7.1 Credenciais (já cobre se fez a Camada 1)
Token precisa ter também `instagram_manage_comments`. Verificar:
```
GET https://graph.facebook.com/v21.0/debug_token
  ?input_token={{PAGE_ACCESS_TOKEN}}
  &access_token={{META_APP_ID}}|{{APP_SECRET}}
```
Confirmar `instagram_manage_comments` em `scopes`.

### 7.2 Registrar webhook na Meta (1x por app)
- Meta for Developers → app `{{META_APP_ID}}` → Webhooks → objeto **Instagram**
- Callback URL: `https://social-machine-v31.vercel.app/api/instagram/webhook`
- Verify Token: (já configurado em `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` no Vercel)
- Assinar campo: `comments`

### 7.3 Configurar voz do autoreply
O system prompt usa `brand_name` e `instagram_handle` do workspace. Confirmar:
```sql
SELECT key, value FROM workspace_settings
WHERE workspace_id = '{{WORKSPACE_ID}}'
  AND key IN ('brand_name', 'instagram_handle');
```
Corrigir se necessário:
```sql
INSERT INTO workspace_settings (workspace_id, key, value) VALUES
('{{WORKSPACE_ID}}', 'brand_name', '{{BRAND_NAME}}'),
('{{WORKSPACE_ID}}', 'instagram_handle', '{{PROFILE_NAME}}')
ON CONFLICT (workspace_id, key) DO UPDATE SET value = EXCLUDED.value;
```

### 7.4 Verificar que o roteamento está correto
O webhook roteia pelo `igBusinessId`. Confirmar no banco:
```sql
SELECT platform_credentials->'instagram'->>'igBusinessId' as ig_id
FROM workspaces WHERE id = '{{WORKSPACE_ID}}';
```
Deve retornar `{{IG_BUSINESS_ID}}`.

### 7.5 Testar ponta-a-ponta
1. Comentar num post do perfil de uma **conta diferente**
2. Aguardar ~10s e conferir na fila:
```sql
SELECT from_username, text, status, ai_reply
FROM instagram_comment_interactions
WHERE workspace_id = '{{WORKSPACE_ID}}'
ORDER BY created_at DESC LIMIT 5;
```

---

## 8. Checklist de replicação (ordem de execução)

```
[ ] 1. Criar workspace no banco (se ainda não existir)
[ ] 2. Salvar credenciais Instagram (Camada 1 — passo de configuração)
[ ] 3. Configurar workspace_settings: brand_name, instagram_handle, reviewer_weights
[ ] 4. Executar backfill de métricas (?backfill=1)
[ ] 5. Validar SQL: reach populado em pelo menos alguns reels
[ ] 6. Registrar webhook Meta (se não estiver registrado para este app)
[ ] 7. Verificar escopo instagram_manage_comments no token
[ ] 8. Testar autoreply com comentário de conta externa
[ ] 9. Aguardar 3+ semanas → validar SQL do Curator (Camada 4)
[ ] 10. Tunar reviewer_weights conforme nicho do perfil
```

---

## 9. Referências de código

| Componente | Arquivo |
|---|---|
| Captura de métricas | `src/app/api/cron/reels-metrics/route.ts` |
| Módulo de engajamento | `src/lib/eval/engagement-metrics.ts` |
| Insights para Writer/Reviewer | `src/lib/eval/engagement-insights.ts` |
| Pesos configuráveis do Reviewer | `src/lib/settings/load-settings.ts` (keys `reviewer_weight_*`) |
| Curator por autor | `src/lib/eval/curator-feedback.ts` |
| Webhook de comentários | `src/app/api/instagram/webhook/route.ts` |
| Worker de comentários | `src/app/api/cron/instagram-comments/route.ts` |
| Utilitários do webhook | `src/lib/platforms/instagram/webhook-utils.ts` |

---

*Baseado em uma implementação de referência anonimizada.*
*Todos os comportamentos descritos foram verificados em produção.*
