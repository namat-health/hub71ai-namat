-- Accept the approved v2 intake while preserving saved and in-flight v1 forms.
-- No rows, answer fields, report permissions or retention policies change.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.hackathon_welcome_submissions
  DROP CONSTRAINT hackathon_welcome_submissions_questionnaire_version_check;
ALTER TABLE public.hackathon_welcome_submissions
  ADD CONSTRAINT hackathon_welcome_submissions_questionnaire_version_check
  CHECK (questionnaire_version IN ('namat-hackathon-welcome-v1', 'namat-hackathon-welcome-v2'));
COMMIT;
