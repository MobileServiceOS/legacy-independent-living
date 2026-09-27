import { env } from "../env";

/** Same-origin check for JSON route handlers (server actions do this themselves). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const o = new URL(origin);
    const self = new URL(env.appUrl);
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return o.host === self.host || (host !== null && o.host === host);
  } catch {
    return false;
  }
}
