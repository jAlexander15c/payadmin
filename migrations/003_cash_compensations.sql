CREATE TABLE cash_compensations (
 id uuid PRIMARY KEY,
 request_key uuid UNIQUE NOT NULL,
 contribution_id uuid NOT NULL REFERENCES contributions(id),
 amount numeric(18,2) NOT NULL CHECK(amount > 0),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','void')),
 revision integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES app_users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
