const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

/** "https://*.ngrok-free.app" → a regex matching any one subdomain; plain origins stay strings. */
const pattern = (o: string) =>
  o.includes("*") ? new RegExp(`^${o.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("[a-z0-9-]+")}$`, "i") : o;

/** Allowed frontend origins: CLIENT_ORIGIN (comma-separated, `*` = any subdomain) if set, otherwise any localhost port. */
export const CLIENT_ORIGIN: (string | RegExp)[] = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean).map(pattern)
  : [LOCALHOST];

/**
 * Whether a browser request comes from our frontend. WebSockets aren't covered
 * by CORS, so the live connection checks this itself (otherwise any site could
 * open a socket with the visitor's session cookie). A page served from the same
 * host as the API (a proxy forwarding /api with the original Host) is ours too.
 */
export function originAllowed(origin: string | undefined, host?: string | string[]) {
  if (!origin) return false;
  if (CLIENT_ORIGIN.some((o) => (typeof o === "string" ? o === origin : o.test(origin)))) return true;
  const hosts = (Array.isArray(host) ? host : [host]).flatMap((h) => (h ? h.split(",").map((x) => x.trim()) : []));
  try {
    return hosts.includes(new URL(origin).host);
  } catch {
    return false;
  }
}
