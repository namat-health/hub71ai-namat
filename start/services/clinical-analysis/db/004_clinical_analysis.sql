-- Apply explicitly after 001, 002 and 003 on the existing intake database.
-- Fictional data only. This migration creates no users. If the existing
-- restricted runtime role is present, add only the grants needed below.
CREATE TABLE public.namat_analysis_budget (
  id text PRIMARY KEY CHECK (id = 'hackathon-2026'),
  limit_micros bigint NOT NULL CHECK (limit_micros BETWEEN 0 AND 20000000),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.namat_analysis_budget(id,limit_micros) VALUES ('hackathon-2026',20000000);

-- Reservations are not expired automatically: a timed-out provider request may
-- still have incurred a charge. Only known usage (including known zero) settles.
CREATE TABLE public.namat_analysis_spend (
  id uuid PRIMARY KEY,
  budget_id text NOT NULL REFERENCES public.namat_analysis_budget(id),
  reserved_micros bigint NOT NULL CHECK (reserved_micros BETWEEN 1 AND 20000000),
  actual_micros bigint CHECK (actual_micros >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CHECK ((actual_micros IS NULL) = (settled_at IS NULL))
);
CREATE INDEX namat_analysis_spend_budget_idx ON public.namat_analysis_spend(budget_id);
-- Ring-fence the local fictional evaluation allocation inside the same $20 cap.
-- The local runner has its own durable $5 ledger; production can spend at most
-- the remaining $15 until operations closes/reconciles that allocation.
-- Never remove or auto-expire this reservation to make more budget available.
INSERT INTO public.namat_analysis_spend(id,budget_id,reserved_micros)
VALUES ('4d2d22a0-4339-4a7a-9a50-09d3a76f1505','hackathon-2026',5000000);

CREATE TABLE public.namat_analysis_runs (
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES public.hackathon_welcome_submissions(id) ON DELETE CASCADE,
  cache_key char(64) NOT NULL CHECK (cache_key ~ '^[a-f0-9]{64}$'),
  case_fingerprint char(64) NOT NULL CHECK (case_fingerprint ~ '^[a-f0-9]{64}$'),
  input_snapshot jsonb NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object' AND octet_length(input_snapshot::text) <= 500000),
  analysis jsonb NOT NULL CHECK (jsonb_typeof(analysis) = 'object' AND octet_length(analysis::text) <= 1000000),
  metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 500000),
  evaluated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > evaluated_at AND expires_at <= evaluated_at + interval '7 days'),
  UNIQUE(id,submission_id)
);
CREATE INDEX namat_analysis_runs_cache_idx ON public.namat_analysis_runs(submission_id,cache_key,created_at DESC,id DESC);
CREATE INDEX namat_analysis_runs_expiry_idx ON public.namat_analysis_runs(expires_at);

CREATE TABLE public.namat_analysis_decisions (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  case_fingerprint char(64) NOT NULL CHECK (case_fingerprint ~ '^[a-f0-9]{64}$'),
  actor text NOT NULL CHECK (length(actor) BETWEEN 1 AND 256),
  selected_test_ids jsonb NOT NULL CHECK (jsonb_typeof(selected_test_ids) = 'array' AND jsonb_array_length(selected_test_ids) <= 80),
  decision text NOT NULL CHECK (decision IN ('approved','rejected','needs_changes')),
  notes text NOT NULL CHECK (length(notes) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (run_id,submission_id) REFERENCES public.namat_analysis_runs(id,submission_id) ON DELETE CASCADE
);
CREATE INDEX namat_analysis_decisions_run_idx ON public.namat_analysis_decisions(run_id,created_at DESC,id DESC);

CREATE TABLE public.namat_analysis_inventory_reviews (
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES public.hackathon_welcome_submissions(id) ON DELETE CASCADE,
  report_id uuid NOT NULL REFERENCES public.namat_reports(id) ON DELETE CASCADE,
  extraction_id uuid NOT NULL,
  review_revision integer NOT NULL CHECK (review_revision >= 0),
  actor text NOT NULL CHECK (length(actor) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (extraction_id,report_id) REFERENCES public.namat_report_extractions(id,report_id) ON DELETE CASCADE,
  UNIQUE(report_id,extraction_id,review_revision)
);
CREATE INDEX namat_analysis_inventory_reviews_submission_idx ON public.namat_analysis_inventory_reviews(submission_id);

CREATE FUNCTION public.namat_analysis_reject_history_update() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Analysis history is immutable' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER namat_analysis_runs_immutable BEFORE UPDATE ON public.namat_analysis_runs
FOR EACH ROW EXECUTE FUNCTION public.namat_analysis_reject_history_update();
CREATE TRIGGER namat_analysis_decisions_immutable BEFORE UPDATE ON public.namat_analysis_decisions
FOR EACH ROW EXECUTE FUNCTION public.namat_analysis_reject_history_update();
CREATE TRIGGER namat_analysis_inventory_reviews_immutable BEFORE UPDATE ON public.namat_analysis_inventory_reviews
FOR EACH ROW EXECUTE FUNCTION public.namat_analysis_reject_history_update();
-- Retention cascades from the existing fictional submission. Keep spend rows:
-- deleting an expired case must never restore money already spent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='namat_hackathon_runtime') THEN
    GRANT SELECT ON public.namat_analysis_budget,public.namat_analysis_spend,
      public.namat_analysis_runs,public.namat_analysis_decisions,
      public.namat_analysis_inventory_reviews TO namat_hackathon_runtime;
    GRANT INSERT ON public.namat_analysis_spend,public.namat_analysis_runs,
      public.namat_analysis_decisions,public.namat_analysis_inventory_reviews TO namat_hackathon_runtime;
    GRANT UPDATE (actual_micros,settled_at) ON public.namat_analysis_spend TO namat_hackathon_runtime;
    -- SELECT FOR UPDATE requires UPDATE on at least one column. These narrow
    -- grants support the locks without permitting budget-cap/reservation edits.
    GRANT UPDATE (created_at) ON public.namat_analysis_budget TO namat_hackathon_runtime;
    GRANT UPDATE (id) ON public.hackathon_welcome_submissions TO namat_hackathon_runtime;
  END IF;
END $$;
