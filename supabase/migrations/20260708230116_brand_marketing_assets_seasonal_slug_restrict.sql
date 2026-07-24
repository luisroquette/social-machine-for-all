ALTER TABLE brand_marketing_assets DROP CONSTRAINT brand_marketing_assets_seasonal_slug_fkey;

ALTER TABLE brand_marketing_assets ADD CONSTRAINT brand_marketing_assets_seasonal_slug_fkey
  FOREIGN KEY (seasonal_slug) REFERENCES brand_seasonal_dates(slug) ON DELETE RESTRICT;;
