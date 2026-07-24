# Trend Video MVP

Novo pipeline paralelo ao fluxo atual de reels:

`trend BR -> filtro -> pacote criativo -> imagem -> capa -> Higgsfield -> publish`

## Objetivo

Gerar 1 video viral por dia a partir de temas em alta no Brasil, sem depender de video-fonte externo.

## Tabelas

- `br_trend_topics`
- `trend_video_jobs`
- `trend_style_stats`

Migration: [supabase/migrations/022_trend_video_pipeline.sql](/Users/luisroquette/social-machine-v3.1/supabase/migrations/022_trend_video_pipeline.sql:1)

## Endpoints

- `/api/cron/trend-discovery-br`
- `/api/cron/trend-creative-prepare`
- `/api/cron/trend-video-animate`
- `/api/cron/trend-video-publish`
- `/api/cron/trend-video-metrics`
- `/api/og/trend-reel-cover`

## Variáveis

Obrigatórias para MVP:

- `CRON_SECRET`
- `APP_BASE_URL`
- `OPENAI_API_KEY` ou Gemini configurado
- `HIGGSFIELD_API_BASE`
- `HIGGSFIELD_API_KEY_ID`
- `HIGGSFIELD_API_SECRET_KEY`
- `INSTAGRAM_APP_ID`
- `INSTAGRAM_USER_ID`
- `INSTAGRAM_ACCESS_TOKEN`

Opcionais do Higgsfield:

- `HIGGSFIELD_CREATE_PATH`
- `HIGGSFIELD_STATUS_PATH`

## Configuração no painel

Tela: `Settings -> Sources -> Trend Video`

Campos mínimos:

- ativar `Trend Video`
- `Sources = google_trends,x_trending`
- `Country Code = BR`
- `Max Jobs por Dia = 1`
- `Shots por Video = 4`
- `Duracao por Shot = 4`
- `Rotacao de Estilos = ultrarealista,anime,abstrato-cinematic`
- `Modelo Higgsfield = dop-preview`

## Ordem de teste manual

Rodar nesta ordem:

```bash
curl -s "http://localhost:3000/api/cron/trend-discovery-br" \
  -H "Authorization: Bearer $CRON_SECRET"

curl -s "http://localhost:3000/api/cron/trend-creative-prepare" \
  -H "Authorization: Bearer $CRON_SECRET"

curl -s "http://localhost:3000/api/cron/trend-video-animate" \
  -H "Authorization: Bearer $CRON_SECRET"

curl -s "http://localhost:3000/api/cron/trend-video-publish" \
  -H "Authorization: Bearer $CRON_SECRET"
```

## Estados esperados

`br_trend_topics.status`
- `new`
- `queued`
- `discarded`
- `processed`

`trend_video_jobs.status`
- `creative_ready`
- `image_ready`
- `cover_ready`
- `rendering`
- `ready`
- `published`
- `failed`

## Limitações atuais

- Fonte ativa: somente `google_trends`
- Adapter Higgsfield depende do endpoint real da conta
- Publish MVP: somente Instagram
- Ainda nao existe dashboard proprio para fila/metricas do trend video
