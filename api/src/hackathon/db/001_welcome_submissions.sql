-- Isolated fictional hackathon intake. Apply only after the event flow review.
-- This migration creates no users/grants and changes no journey tables.
CREATE TABLE public.hackathon_welcome_submissions (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  receipt_id uuid NOT NULL UNIQUE,
  questionnaire_version text NOT NULL CHECK (questionnaire_version = 'namat-hackathon-welcome-v1'),
  data_class text NOT NULL CHECK (data_class = 'synthetic'),
  fictional_confirmed boolean NOT NULL CHECK (fictional_confirmed),
  answers jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'object'),
  notes jsonb NOT NULL CHECK (jsonb_typeof(notes) = 'object'),
  fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  first_name text CHECK (first_name IS NULL OR length(first_name) BETWEEN 1 AND 80),
  report_metadata jsonb NOT NULL CHECK (jsonb_typeof(report_metadata) = 'array'),
  report_files bytea[] NOT NULL,
  report_total_size integer NOT NULL CHECK (report_total_size BETWEEN 0 AND 2097152),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days'),
  CHECK (cardinality(report_files) BETWEEN 0 AND 3 AND jsonb_array_length(report_metadata) = cardinality(report_files)),
  CHECK (cardinality(report_files) = 0 OR (array_ndims(report_files) = 1 AND array_lower(report_files,1) = 1)),
  CHECK (array_position(report_files,NULL) IS NULL),
  CHECK (report_total_size = COALESCE(octet_length(report_files[1]),0) + COALESCE(octet_length(report_files[2]),0) + COALESCE(octet_length(report_files[3]),0)),
  CHECK (cardinality(report_files) = 0 OR (report_total_size > 0
    AND octet_length(report_files[1]) > 0
    AND (cardinality(report_files) < 2 OR octet_length(report_files[2]) > 0)
    AND (cardinality(report_files) < 3 OR octet_length(report_files[3]) > 0)))
);
CREATE INDEX hackathon_welcome_submissions_expiry_idx ON public.hackathon_welcome_submissions (expires_at);

-- One confirmation per submission. Never include answers, notes or report
-- bytes in an email payload. Provider delivery is a separately gated action.
CREATE TABLE public.hackathon_email_outbox (
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL UNIQUE REFERENCES public.hackathon_welcome_submissions(id) ON DELETE CASCADE,
  reference uuid NOT NULL UNIQUE,
  data_class text NOT NULL CHECK (data_class = 'synthetic'),
  recipient_email text NOT NULL CHECK (length(recipient_email) BETWEEN 3 AND 254),
  first_name text,
  has_reports boolean NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','local','failed','unknown')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claim_token uuid,
  claimed_at timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  provider_message_id text,
  last_error_code text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);
CREATE INDEX hackathon_email_outbox_queue_idx ON public.hackathon_email_outbox (status,created_at);
