import { NextResponse } from "next/server";
import { publicUrl } from "@/lib/public-url";
import { DEMO_EMAIL_COOKIE, getDemoSubmissions } from "@/lib/submissions";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store, max-age=0" };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function home(request, error) {
  const url = publicUrl(request, "/");
  url.searchParams.set("error", error);
  const response = NextResponse.redirect(url, {
    status: 303,
    headers: noStore,
  });
  response.cookies.set(DEMO_EMAIL_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}

export async function POST(request) {
  let email;
  try {
    email = String((await request.formData()).get("email") || "").trim();
  } catch {
    return home(request, "invalid");
  }

  if (email.length > 254 || !emailPattern.test(email))
    return home(request, "invalid");

  try {
    if (!(await getDemoSubmissions(email)).length)
      return home(request, "not-found");
  } catch {
    return home(request, "unavailable");
  }

  const response = NextResponse.redirect(publicUrl(request, "/profile"), {
    status: 303,
    headers: noStore,
  });
  response.cookies.set(DEMO_EMAIL_COOKIE, email, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return response;
}
