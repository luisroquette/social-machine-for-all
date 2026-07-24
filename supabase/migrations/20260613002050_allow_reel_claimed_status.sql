-- A worker may claim a prepared reel before publishing it. The status is
-- generic so the same schema supports every workspace.
ALTER TABLE public.generated_content
  DROP CONSTRAINT generated_content_status_check;
ALTER TABLE public.generated_content
  ADD CONSTRAINT generated_content_status_check
  CHECK (status = ANY (ARRAY[
    'draft'::text, 'reviewed'::text, 'approved'::text, 'rejected'::text,
    'published'::text, 'failed'::text, 'publishing'::text, 'reel_ready'::text,
    'reel_claimed'::text
  ]));
