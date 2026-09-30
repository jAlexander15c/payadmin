-- Confirmation of provisional dates must not rewrite financial parameter versions.
CREATE TABLE loan_schedule_versions (
 id uuid PRIMARY KEY,
 first_due date NOT NULL,
 created_by uuid NOT NULL REFERENCES app_users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
