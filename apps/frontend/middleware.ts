import { NextResponse, type NextRequest } from "next/server";
import { apiTarget } from "./lib/apiTarget";

/** Trình duyệt chỉ nói chuyện với Next (cùng origin) ⇒ cookie HttpOnly + SameSite=Strict, không cần CORS. */
export function middleware(req: NextRequest) {
  return NextResponse.rewrite(apiTarget(process.env.API_INTERNAL_URL, req.nextUrl.pathname, req.nextUrl.search));
}

export const config = { matcher: "/api/:path*" };
