CREATE TABLE IF NOT EXISTS app_users (
 id uuid PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE login_attempts (key text PRIMARY KEY, attempts integer NOT NULL, window_start timestamptz NOT NULL);
CREATE TABLE loans (
 id integer PRIMARY KEY CHECK (id=1), owner_name text NOT NULL, bank text NOT NULL,
 initial_capital numeric(18,2) NOT NULL, official_months integer NOT NULL, reported_effective_rate numeric(12,8) NOT NULL
);
CREATE TABLE parameter_versions (
 id uuid PRIMARY KEY, effective_period text UNIQUE NOT NULL CHECK(effective_period ~ '^\d{4}-\d{2}$'),
 annual_interest numeric(12,8) NOT NULL, annual_feci numeric(12,8) NOT NULL,
 regular_payment numeric(18,2) NOT NULL, chunky_payment numeric(18,2) NOT NULL, credi_payment numeric(18,2) NOT NULL,
 first_due date NOT NULL, provisional boolean NOT NULL DEFAULT true,
 salary numeric(18,2) NOT NULL, salary_includes_loan boolean NOT NULL DEFAULT false,
 created_by uuid REFERENCES app_users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sources (
 id text PRIMARY KEY, label text NOT NULL, initial_capital numeric(18,2) NOT NULL, deadline date, max_months integer
);
CREATE TABLE composition (
 id text PRIMARY KEY, source_id text REFERENCES sources(id), concept text NOT NULL,
 amount numeric(18,2) NOT NULL, kind text NOT NULL
);
CREATE TABLE legacy_chunky (
 period text PRIMARY KEY, payment numeric(18,2) NOT NULL
);
CREATE TABLE bank_movements (
 id uuid PRIMARY KEY, request_key uuid UNIQUE NOT NULL, occurred_on date NOT NULL, period text NOT NULL,
 type text NOT NULL CHECK(type IN ('REGULAR','CREDI','EXTRA_CREDI','EXTRA_CHUNKY','EXTRA_CARDS','EXTRA_COSTS','NO_PAYMENT')),
 amount numeric(18,2) NOT NULL CHECK(amount >= 0), notes text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','void')),
 revision integer NOT NULL DEFAULT 1, created_by uuid NOT NULL REFERENCES app_users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bank_period ON bank_movements(period, occurred_on, created_at);
CREATE TABLE statements (
 period text PRIMARY KEY, interest numeric(18,2), feci numeric(18,2), other_charges numeric(18,2),
 other_concept text NOT NULL DEFAULT '', principal_paid numeric(18,2), reported_balance numeric(18,2),
 notes text NOT NULL DEFAULT '', updated_by uuid NOT NULL REFERENCES app_users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE contributions (
 id uuid PRIMARY KEY, request_key uuid UNIQUE NOT NULL, occurred_on date NOT NULL, period text NOT NULL,
 source_id text NOT NULL REFERENCES sources(id), contributor text NOT NULL, amount numeric(18,2) NOT NULL CHECK(amount > 0),
 notes text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','void')),
 revision integer NOT NULL DEFAULT 1, created_by uuid NOT NULL REFERENCES app_users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE contribution_links (
 movement_id uuid NOT NULL REFERENCES bank_movements(id), contribution_id uuid NOT NULL REFERENCES contributions(id),
 amount numeric(18,2) NOT NULL CHECK(amount > 0), PRIMARY KEY(movement_id, contribution_id)
);
CREATE TABLE allocations (
 movement_id uuid NOT NULL REFERENCES bank_movements(id) ON DELETE CASCADE, source_id text NOT NULL REFERENCES sources(id),
 principal numeric(18,2) NOT NULL, interest numeric(18,2) NOT NULL, feci numeric(18,2) NOT NULL,
 other_paid numeric(18,2) NOT NULL, compensation numeric(18,2) NOT NULL, advance numeric(18,2) NOT NULL,
 PRIMARY KEY(movement_id, source_id)
);
CREATE TABLE compensations (
 movement_id uuid PRIMARY KEY REFERENCES bank_movements(id), advanced numeric(18,2) NOT NULL,
 reimbursed numeric(18,2) NOT NULL, pending_after numeric(18,2) NOT NULL
);
CREATE TABLE period_results (
 period text PRIMARY KEY, result jsonb NOT NULL, recalculated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE responsibility_versions (
 id uuid PRIMARY KEY, effective_period text UNIQUE NOT NULL, participants jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES app_users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cash_entries (
 id uuid PRIMARY KEY, request_key uuid UNIQUE NOT NULL, occurred_on date NOT NULL, period text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('PAYROLL','INCOME','EXPENSE','SAVING')),
 category text NOT NULL CHECK(category IN ('NEEDS','WANTS','DEBT','SAVINGS','OTHER')),
 amount numeric(18,2) NOT NULL CHECK(amount > 0), concept text NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','void')), revision integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES app_users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_log (
 id bigserial PRIMARY KEY, user_id uuid REFERENCES app_users(id), entity text NOT NULL, entity_id text NOT NULL,
 action text NOT NULL, before_data jsonb, after_data jsonb, reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO loans VALUES(1,'Javier Alexander Carrión Moreno','Banco General',18150,84,0.1172);
INSERT INTO parameter_versions(id,effective_period,annual_interest,annual_feci,regular_payment,chunky_payment,credi_payment,first_due,salary)
 VALUES('00000000-0000-4000-8000-000000000001','2026-10',0.095,0.01,317.60,171.24,62.56,'2026-10-15',1310.92);
INSERT INTO sources VALUES
 ('chunky','Chunky Bites',7024.34,'2031-06-02',NULL),('credi','CrediJamar',1349,NULL,24),
 ('cards','Tarjetas personales',8003.08,NULL,NULL),('costs','Costos / otros',1773.58,NULL,NULL);
INSERT INTO composition VALUES
 ('chunky','chunky','Cancelación del préstamo anterior',7024.34,'debt'),
 ('sofa','credi','Sofá CrediJamar',1349,'debt'),
 ('bg','cards','Tarjeta Banco General',1855.31,'debt'),('lafise','cards','Tarjeta Banco Lafise',3622.41,'debt'),
 ('banesco','cards','Tarjeta Banesco',2525.36,'debt'),
 ('commission','costs','Comisión de manejo',1121.35,'expense'),('itbms','costs','ITBMS',78.49,'expense'),
 ('notary','costs','Notaría',1.50,'expense'),('stamps','costs','Timbres',18.20,'expense'),
 ('insurance','costs','Seguro de vida inicial',209.31,'expense'),
 ('quoted_interest','costs','Interés al primer pago cotizado (composición financiada)',317.60,'financed'),
 ('cash','costs','Efectivo recibido',27.13,'cash');
INSERT INTO legacy_chunky VALUES('2025-11',57.42),('2025-12',85.62),('2026-01',0),
 ('2026-02',171.24),('2026-03',171.24),('2026-04',171.24),('2026-05',171.24),('2026-06',171.24),
 ('2026-07',171.24),('2026-08',171.24),('2026-09',171.24);
