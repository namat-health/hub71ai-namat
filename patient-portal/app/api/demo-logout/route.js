import { NextResponse } from "next/server";
import { publicUrl } from "@/lib/public-url";
import { DEMO_EMAIL_COOKIE } from "@/lib/submissions";

export async function POST(request) {
  const response = NextResponse.redirect(publicUrl(request, "/"), {
    status: 303,
  });
  response.cookies.set(DEMO_EMAIL_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
