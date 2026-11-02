import { NextResponse } from "next/server";
import { ACCESS_COOKIE, accessToken, passwordIsValid } from "@/lib/site-access";

export async function POST(request: Request) {
  const form = await request.formData();
  const password = form.get("password");
  if (typeof password !== "string" || !(await passwordIsValid(password))) {
    return Response.json({ error: "That access code is not correct." }, { status: 401 });
  }
  const token = await accessToken();
  if (!token) return Response.json({ error: "Site access is not configured." }, { status: 503 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 7 });
  return response;
}
