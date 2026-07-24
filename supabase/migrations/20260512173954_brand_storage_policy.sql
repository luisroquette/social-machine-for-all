
CREATE POLICY "Public read brand-mob"
ON storage.objects FOR SELECT
USING (bucket_id = 'brand-mob');

CREATE POLICY "Service role write brand-mob"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'brand-mob');

CREATE POLICY "Service role upsert brand-mob"
ON storage.objects FOR UPDATE
USING (bucket_id = 'brand-mob');
;
