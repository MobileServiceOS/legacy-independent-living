/**
 * Edge gate: bounce requests without a session cookie away from protected
 * areas early. Real authorization (valid session, role, ownership) is always
 * re-checked on the server in layouts, pages, actions and route handlers.
 */
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/admin", "/home", "/pay", "/payments", "/documents", "/notifications", "/profile", "/receipts"];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const needsAuth = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (needsAuth && !req.cookies.get("lil_session")?.value) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icons|brand|sw.js|offline.html|manifest.webmanifest|api/webhooks|api/cron|api/health).*)"],
};
