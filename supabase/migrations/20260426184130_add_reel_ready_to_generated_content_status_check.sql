
ALTER TABLE generated_content
  DROP CONSTRAINT generated_content_status_check;

ALTER TABLE generated_content
  ADD CONSTRAINT generated_content_status_check
  CHECK (status = ANY (ARRAY[
    'draft'::text,
    'reviewed'::text,
    'approved'::text,
    'rejected'::text,
    'published'::text,
    'failed'::text,
    'publishing'::text,
    'reel_ready'::text
  ]));
;
