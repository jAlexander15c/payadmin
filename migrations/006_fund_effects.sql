-- Nullable while the previous application is running during predeploy.
-- Existing rows retain the financial meaning of their operation.
ALTER TABLE fund_adjustments ADD COLUMN effect text
 CHECK(effect IN ('ALLOCATION','INCOME','EXPENSE','ADJUSTMENT'));
ALTER TABLE fund_adjustments ADD CONSTRAINT fund_effect_operation_check CHECK(
 effect IS NULL OR
 (operation='SET' AND effect='ADJUSTMENT') OR
 (operation='ADD' AND effect IN ('ALLOCATION','INCOME')) OR
 (operation='REMOVE' AND effect IN ('EXPENSE','ADJUSTMENT'))
);
