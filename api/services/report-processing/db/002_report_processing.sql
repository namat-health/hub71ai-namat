-- Additive report storage and processing records. Apply explicitly after the
-- legacy fictional-submission migration. This creates no users or grants.
CREATE TABLE public.namat_report_sessions (
  id uuid PRIMARY KEY,
  token_hash char(64) NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours')
);

CREATE TABLE public.namat_reports (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.namat_report_sessions(id),
  submission_id uuid REFERENCES public.hackathon_welcome_submissions(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160 AND octet_length(name) <= 256),
  mime text NOT NULL CHECK (mime IN ('application/pdf','image/jpeg','image/png')),
  size integer NOT NULL CHECK (size BETWEEN 1 AND 10485760),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  blob_key text NOT NULL UNIQUE CHECK (length(blob_key) BETWEEN 1 AND 512),
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','queued','processing','ready','failed','rejected')),
  page_count integer CHECK (page_count BETWEEN 1 AND 50),
  error_code text CHECK (error_code ~ '^[a-z][a-z0-9_]{0,79}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days')
);
CREATE INDEX namat_reports_session_idx ON public.namat_reports(session_id);
CREATE INDEX namat_reports_submission_idx ON public.namat_reports(submission_id) WHERE submission_id IS NOT NULL;
CREATE INDEX namat_reports_expiry_idx ON public.namat_reports(expires_at);

CREATE TABLE public.namat_report_jobs (
  id uuid PRIMARY KEY,
  report_id uuid NOT NULL UNIQUE REFERENCES public.namat_reports(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','succeeded','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  manual_retries integer NOT NULL DEFAULT 0 CHECK (manual_retries BETWEEN 0 AND 3),
  last_retry_at timestamptz,
  last_failure_code text CHECK (last_failure_code ~ '^[a-z][a-z0-9_]{0,79}$'),
  lease_token uuid,
  lease_expires_at timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  error_code text CHECK (error_code ~ '^[a-z][a-z0-9_]{0,79}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (id, report_id),
  CHECK ((status = 'processing') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX namat_report_jobs_queue_idx ON public.namat_report_jobs(status,available_at,created_at);

CREATE TABLE public.namat_report_ocr_budget (
  day date PRIMARY KEY,
  pages integer NOT NULL CHECK (pages >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.namat_report_extractions (
  id uuid PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES public.namat_reports(id) ON DELETE CASCADE,
  job_id uuid NOT NULL UNIQUE,
  processor_version text NOT NULL CHECK (length(processor_version) BETWEEN 1 AND 160),
  input_sha256 char(64) NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  pages jsonb NOT NULL CHECK (jsonb_typeof(pages) = 'array' AND jsonb_array_length(pages) BETWEEN 1 AND 50 AND octet_length(pages::text) <= 8000000),
  observations jsonb NOT NULL CHECK (jsonb_typeof(observations) = 'array' AND octet_length(observations::text) <= 2000000),
  warnings jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(warnings) = 'array' AND octet_length(warnings::text) <= 1000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, report_id),
  FOREIGN KEY (job_id, report_id) REFERENCES public.namat_report_jobs(id, report_id) ON DELETE CASCADE
);
CREATE INDEX namat_report_extractions_report_idx ON public.namat_report_extractions(report_id,created_at DESC,id DESC);

CREATE TABLE public.namat_report_reviews (
  id uuid PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES public.namat_reports(id) ON DELETE CASCADE,
  extraction_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  observations jsonb NOT NULL CHECK (jsonb_typeof(observations) = 'array' AND octet_length(observations::text) <= 2000000),
  decision text NOT NULL CHECK (decision IN ('approved','corrected','needs_changes')),
  actor text NOT NULL CHECK (length(actor) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, revision),
  FOREIGN KEY (extraction_id, report_id) REFERENCES public.namat_report_extractions(id, report_id) ON DELETE CASCADE
);

-- Output history is append-only. DELETE remains available to the separately
-- authorized retention role, including cascades when originals expire.
CREATE FUNCTION public.namat_report_reject_history_update() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Report history is immutable' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER namat_report_extractions_immutable BEFORE UPDATE ON public.namat_report_extractions
FOR EACH ROW EXECUTE FUNCTION public.namat_report_reject_history_update();
CREATE TRIGGER namat_report_reviews_immutable BEFORE UPDATE ON public.namat_report_reviews
FOR EACH ROW EXECUTE FUNCTION public.namat_report_reject_history_update();

-- Fixed, argument-free retention operation. The runtime needs EXECUTE on this
-- function, not DELETE permission on legacy submissions. An active report
-- blocks parent deletion until its private blob has been removed by the worker.
CREATE FUNCTION public.namat_report_cleanup_metadata() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  DELETE FROM public.hackathon_welcome_submissions s WHERE s.expires_at<=now()
    AND NOT EXISTS(SELECT 1 FROM public.namat_reports r WHERE r.submission_id=s.id);
  DELETE FROM public.namat_report_sessions s WHERE s.expires_at<=now()
    AND NOT EXISTS(SELECT 1 FROM public.namat_reports r WHERE r.session_id=s.id);
  DELETE FROM public.namat_report_ocr_budget WHERE day < (now() AT TIME ZONE 'UTC')::date - 31;
END $$;
REVOKE ALL ON FUNCTION public.namat_report_cleanup_metadata() FROM PUBLIC;
