CREATE TABLE fixed_expenses (
 id uuid PRIMARY KEY,
 request_key uuid UNIQUE NOT NULL,
 revision integer NOT NULL DEFAULT 1
);
CREATE TABLE fixed_expense_versions (
 id uuid PRIMARY KEY,
 fixed_id uuid NOT NULL REFERENCES fixed_expenses(id),
 effective_period text NOT NULL CHECK(effective_period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 name text NOT NULL,
 amount numeric(18,2) NOT NULL CHECK(amount > 0),
 due_day integer NOT NULL CHECK(due_day BETWEEN 1 AND 31),
 active boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL REFERENCES app_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(fixed_id,effective_period)
);
ALTER TABLE cash_entries DROP CONSTRAINT cash_entries_kind_check;
ALTER TABLE cash_entries ADD CONSTRAINT cash_entries_kind_check
 CHECK(kind IN ('PAYROLL','INCOME','EXPENSE','SAVING','SAVINGS_OPENING'));
ALTER TABLE cash_entries ADD COLUMN funding text NOT NULL DEFAULT 'CASH'
 CHECK(funding IN ('CASH','SAVINGS'));
ALTER TABLE cash_entries ADD COLUMN fixed_expense_id uuid REFERENCES fixed_expenses(id);
ALTER TABLE cash_entries ADD CONSTRAINT cash_expense_details_check
 CHECK((funding='CASH' OR kind='EXPENSE') AND (fixed_expense_id IS NULL OR (kind='EXPENSE' AND category='NEEDS')));
CREATE INDEX cash_fixed_period ON cash_entries(fixed_expense_id,period) WHERE status='active';
