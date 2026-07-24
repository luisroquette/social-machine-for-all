
INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-assets', 'brand-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read brand-assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'brand-assets');

CREATE POLICY "Service role write brand-assets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'brand-assets');

CREATE POLICY "Service role upsert brand-assets"
ON storage.objects FOR UPDATE
USING (bucket_id = 'brand-assets');
;
