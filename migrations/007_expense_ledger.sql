ALTER TABLE cash_entries ADD COLUMN ledger text NOT NULL DEFAULT 'BUDGET'
 CHECK(ledger IN ('BUDGET','EXPENSES'));
-- Preserve amounts, dates, revisions and identities. Only separate the records
-- representing spending and savings. Payroll and loan cash income remain in
-- the original budget ledger; bank payments and contributions are untouched.
WITH moved AS (
 UPDATE cash_entries SET ledger='EXPENSES'
 WHERE kind IN ('EXPENSE','SAVING','SAVINGS_OPENING')
 RETURNING *
)
INSERT INTO audit_log(user_id,entity,entity_id,action,before_data,after_data,reason)
 SELECT created_by,'expense',id,'separate_ledger',
 to_jsonb(moved)-'ledger',to_jsonb(moved),
 'Separación del control de gastos y el presupuesto del préstamo'
 FROM moved;
CREATE INDEX cash_ledger_date ON cash_entries(ledger,occurred_on);
-- The old deployment can still insert during predeploy. Infer its ledger
-- only when it did not supply one; the new application always supplies it.
ALTER TABLE cash_entries ALTER COLUMN ledger DROP DEFAULT;
CREATE FUNCTION assign_cash_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.ledger IS NULL THEN
  NEW.ledger := CASE WHEN NEW.kind IN ('EXPENSE','SAVING','SAVINGS_OPENING')
   THEN 'EXPENSES' ELSE 'BUDGET' END;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER cash_ledger_default BEFORE INSERT ON cash_entries
 FOR EACH ROW EXECUTE FUNCTION assign_cash_ledger();
