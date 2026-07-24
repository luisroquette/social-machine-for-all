-- Repost em Stories dos Reels publicados usava a capa gerada (story_cover_url,
-- image_url na Graph API). Passa a usar o vídeo curado que já foi publicado no
-- feed, então precisa de coluna própria (stories-publisher decide image_url vs
-- video_url conforme qual estiver preenchida). story_cover_url continua em uso
-- para os fluxos de imagem (carrossel/feed/brand-marketing-assets).

ALTER TABLE public.generated_content
  ADD COLUMN IF NOT EXISTS story_video_url TEXT;
