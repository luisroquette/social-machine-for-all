-- Separar o sinal de engajamento da nota de qualidade do reviewer.
-- Antes, o cron reels-metrics sobrescrevia review_score com o engagement score,
-- poluindo a nota de qualidade (reels caíram p/ ~2.24). Agora vão em colunas dedicadas.
ALTER TABLE public.generated_content
  ADD COLUMN IF NOT EXISTS engagement_score numeric(4,2),
  ADD COLUMN IF NOT EXISTS engagement_metrics jsonb;

COMMENT ON COLUMN public.generated_content.engagement_score IS 'Score 0-10 derivado das métricas reais de engajamento do Instagram (reels-metrics cron). NÃO confundir com review_score (qualidade pré-publicação).';
COMMENT ON COLUMN public.generated_content.engagement_metrics IS 'JSON das métricas brutas do Instagram (reach, likes, saved, shares, watch time, fetched_at). Substitui o uso indevido de review_feedback.';;
