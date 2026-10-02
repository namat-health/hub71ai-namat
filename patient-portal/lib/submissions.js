import { getPostgresPool } from "@/lib/db";

export const DEMO_EMAIL_COOKIE = "namat_demo_email";

export async function getDemoSubmissions(email) {
  const { rows } = await getPostgresPool().query(
    `SELECT id, first_name, email, questionnaire_version, answers, notes, report_metadata, created_at
     FROM public.hackathon_welcome_submissions
     WHERE lower(email) = lower($1)
       AND data_class = 'synthetic'
       AND fictional_confirmed = TRUE
     ORDER BY created_at DESC
     LIMIT 20`,
    [email],
  );

  return rows.map((row) => ({
    id: row.id,
    firstName: row.first_name,
    email: row.email,
    questionnaireVersion: row.questionnaire_version,
    answers: row.answers,
    notes: row.notes,
    reports: Array.isArray(row.report_metadata)
      ? row.report_metadata.map(({ name, type, size }) => ({
          name,
          type,
          size,
        }))
      : [],
    createdAt: new Date(row.created_at).toISOString(),
  }));
}
