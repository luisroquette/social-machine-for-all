ALTER TABLE brand_marketing_assets DROP CONSTRAINT brand_marketing_assets_pillar_check;

ALTER TABLE brand_marketing_assets ADD CONSTRAINT brand_marketing_assets_pillar_check
  CHECK (pillar IN ('dor','modelo','execucao','midia','fomo','diptych','generico','seasonal'));;
