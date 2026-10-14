CREATE TABLE payroll_cycles (
 id uuid PRIMARY KEY, request_key uuid UNIQUE NOT NULL,
 period text NOT NULL, half integer NOT NULL CHECK(half IN (1,2)),
 received_on date NOT NULL, received_amount numeric(18,2) NOT NULL CHECK(received_amount>0),
 deduction_amount numeric(18,2) NOT NULL CHECK(deduction_amount>=0),
 chunky_expected numeric(18,2) NOT NULL CHECK(chunky_expected>=0),
 next_due_on date NOT NULL CHECK(next_due_on>=received_on),
 bank_movement_id uuid REFERENCES bank_movements(id),
 budget_cash_id uuid NOT NULL REFERENCES cash_entries(id),
 owns_bank boolean NOT NULL, owns_cash boolean NOT NULL,
 allocation jsonb NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','void')),
 created_by uuid NOT NULL REFERENCES app_users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payroll_active_half ON payroll_cycles(period,half) WHERE status='active';
CREATE TABLE payroll_receipts (
 id uuid PRIMARY KEY, request_key uuid UNIQUE NOT NULL,
 payroll_id uuid NOT NULL REFERENCES payroll_cycles(id),
 contribution_id uuid UNIQUE NOT NULL REFERENCES contributions(id),
 received_on date NOT NULL, amount numeric(18,2) NOT NULL CHECK(amount>0),
 allocation jsonb NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','void')),
 created_by uuid NOT NULL REFERENCES app_users(id), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cash_entries ADD COLUMN payroll_cycle_id uuid REFERENCES payroll_cycles(id);
ALTER TABLE cash_entries ADD COLUMN payroll_receipt_id uuid REFERENCES payroll_receipts(id);
ALTER TABLE cash_entries ADD CONSTRAINT payroll_entry_scope CHECK(
 (payroll_cycle_id IS NULL AND payroll_receipt_id IS NULL) OR
 (ledger='EXPENSES' AND kind='INCOME' AND num_nonnulls(payroll_cycle_id,payroll_receipt_id)=1)
);
CREATE INDEX payroll_entries_cycle ON cash_entries(payroll_cycle_id);
CREATE INDEX payroll_entries_receipt ON cash_entries(payroll_receipt_id);

CREATE UNIQUE INDEX payroll_active_bank ON payroll_cycles(bank_movement_id) WHERE status='active';
CREATE UNIQUE INDEX payroll_active_cash ON payroll_cycles(budget_cash_id) WHERE status='active';
