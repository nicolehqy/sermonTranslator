import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, cookieHasValidAccess } from "@/lib/site-access";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/access" || path === "/api/access") return NextResponse.next();
  if (await cookieHasValidAccess(request.cookies.get(ACCESS_COOKIE)?.value)) return NextResponse.next();
  if (path.startsWith("/api/")) return Response.json({ error: "Enter the site access code first." }, { status: 401 });
  return NextResponse.redirect(new URL("/access", request.url));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"] };
