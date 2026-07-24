
ALTER TABLE generated_content
  DROP CONSTRAINT generated_content_status_check;

ALTER TABLE generated_content
  ADD CONSTRAINT generated_content_status_check
  CHECK (status = ANY (ARRAY['draft','reviewed','approved','rejected','published','failed','publishing']));
;
