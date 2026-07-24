
INSERT INTO storage.buckets (id, name, public)
VALUES ('reels', 'reels', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Service role upsert for reels"
ON storage.objects
FOR UPDATE
TO service_role
USING (bucket_id = 'reels');
;
