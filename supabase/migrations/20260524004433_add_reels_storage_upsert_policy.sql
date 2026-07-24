
CREATE POLICY "Service role upsert for reels"
ON storage.objects
FOR UPDATE
TO service_role
USING (bucket_id = 'reels');
;
