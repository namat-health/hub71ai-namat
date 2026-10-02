import OpenAI from "openai";
import { PDFParse } from "pdf-parse";
import { requirePortalSession } from "@/lib/portal-access.mjs";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are a helper to detect problems in lab work results.
Given the extracted text of a lab report PDF, report ONLY values that are out of range, borderline, or otherwise noteworthy — anything that could be a problem or deserves attention.
Do NOT list normal results one by one. Just add one short line at the end noting that everything else is within range.
Respond in the same language as the report.
Use Markdown: a short table of flagged values (columns: parameter, result, reference, why it matters), followed by a brief bullet list of the most important findings.
Keep it short and simple. This is for informational purposes only, not medical advice.`;

export async function POST(request) {
  const denied = requirePortalSession(request);
  if (denied) return denied;
  try {
    if (!process.env.OPENAI_API_KEY) {
      return Response.json(
        { error: "Missing OPENAI_API_KEY on the server." },
        { status: 500 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return Response.json({ error: "No PDF file received." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText().catch((err) => {
      throw err;
    });
    const text = (result.text || "").slice(0, 15000);
    await parser.destroy().catch(() => {});

    if (!text.trim()) {
      return Response.json(
        { error: "Could not extract text from this PDF." },
        { status: 400 },
      );
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      // Optional: point at a custom endpoint later (e.g. Azure OpenAI)
      ...(process.env.OPENAI_BASE_URL && {
        baseURL: process.env.OPENAI_BASE_URL,
      }),
    });
    const completion = await openai.chat.completions.create({
      model: "gpt-5.6-luna",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
    });

    return Response.json({
      result: completion.choices[0]?.message?.content ?? "",
    });
  } catch (err) {
    console.error(err);
    return Response.json(
      { error: err?.message || "Failed to analyze PDF." },
      { status: 500 },
    );
  }
}
