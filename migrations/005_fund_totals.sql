CREATE TABLE fund_adjustments (
 id uuid PRIMARY KEY,
 request_key uuid UNIQUE NOT NULL,
 occurred_on date NOT NULL,
 bucket text NOT NULL CHECK(bucket IN ('NEEDS','WANTS','SAVINGS')),
 operation text NOT NULL CHECK(operation IN ('SET','ADD','REMOVE')),
 amount numeric(18,2) NOT NULL CHECK(amount >= 0 AND (operation='SET' OR amount > 0)),
 delta numeric(18,2) NOT NULL,
 before_balance numeric(18,2) NOT NULL,
 after_balance numeric(18,2) NOT NULL,
 reason text NOT NULL,
 created_by uuid NOT NULL REFERENCES app_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(after_balance=before_balance+delta),
 CHECK((operation='SET' AND after_balance=amount) OR (operation='ADD' AND delta=amount) OR (operation='REMOVE' AND delta=-amount))
);
CREATE INDEX fund_adjustments_date ON fund_adjustments(occurred_on,bucket);
