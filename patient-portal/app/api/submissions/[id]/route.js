import { cookies } from "next/headers";
import { getPostgresPool } from "@/lib/db";
import { DEMO_EMAIL_COOKIE } from "@/lib/submissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0" };
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validValues(values, current) {
  if (!isObject(values) || Object.keys(values).length > 40) return false;
  return Object.entries(values).every(([key, value]) => {
    if (!Object.hasOwn(current, key)) return false;
    if (typeof value === "string") return value.length <= 1000;
    return (
      Array.isArray(value) &&
      value.length <= 50 &&
      value.every((item) => typeof item === "string" && item.length <= 100)
    );
  });
}

export async function PATCH(request, { params }) {
  const { id } = await params;
  const email = (await cookies()).get(DEMO_EMAIL_COOKIE)?.value;
  if (!email)
    return Response.json({ error: "Sign in first." }, { status: 401, headers });
  if (!uuidPattern.test(id))
    return Response.json(
      { error: "Submission not found." },
      { status: 404, headers },
    );

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid changes." },
      { status: 400, headers },
    );
  }

  if (
    !isObject(body) ||
    typeof body.firstName !== "string" ||
    body.firstName.length > 120 ||
    JSON.stringify(body).length > 25000
  ) {
    return Response.json(
      { error: "Invalid changes." },
      { status: 400, headers },
    );
  }

  try {
    const pool = getPostgresPool();
    const { rows } = await pool.query(
      `SELECT answers, notes
       FROM public.hackathon_welcome_submissions
       WHERE id = $1::uuid
         AND lower(email) = lower($2)
         AND data_class = 'synthetic'
         AND fictional_confirmed = TRUE`,
      [id, email],
    );
    const current = rows[0];
    if (!current)
      return Response.json(
        { error: "Submission not found." },
        { status: 404, headers },
      );
    if (
      !validValues(body.answers, current.answers) ||
      !validValues(body.notes, current.notes)
    ) {
      return Response.json(
        { error: "Invalid changes." },
        { status: 400, headers },
      );
    }

    const answers = { ...current.answers, ...body.answers };
    const notes = { ...current.notes, ...body.notes };
    await pool.query(
      `UPDATE public.hackathon_welcome_submissions
       SET first_name = $1, answers = $2::jsonb, notes = $3::jsonb
       WHERE id = $4::uuid
         AND lower(email) = lower($5)
         AND data_class = 'synthetic'
         AND fictional_confirmed = TRUE`,
      [
        body.firstName.trim() || null,
        JSON.stringify(answers),
        JSON.stringify(notes),
        id,
        email,
      ],
    );

    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json(
      { error: "Could not save your changes." },
      { status: 503, headers },
    );
  }
}
