/**
 * Where the API lives. NEXT_PUBLIC_API_URL wins when set (production). Otherwise:
 * on localhost the API is on :4000; anywhere else (an ngrok link from `npm run share`)
 * it's on the same origin as the page, under /api.
 */
function apiUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window !== "undefined" && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)) return "";
  return "http://localhost:4000";
}

export const API_URL = apiUrl();

const TIMEOUT_MS = 15_000;

const networkError = (err: unknown) =>
  new ApiError(
    (err as Error)?.name === "TimeoutError"
      ? "The server is taking too long to answer. Try again."
      : "Can't reach the server. Is the backend running?",
    0,
  );

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fieldErrors: Record<string, string> = {},
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const apiPost = <T>(path: string, body: unknown) => send<T>("POST", path, body);
export const apiPut = <T>(path: string, body: unknown) => send<T>("PUT", path, body);
export const apiPatch = <T>(path: string, body: unknown) => send<T>("PATCH", path, body);
export const apiDelete = <T>(path: string) => send<T>("DELETE", path);

async function send<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      // No body (DELETE) → no JSON content type, or the server rejects the empty body.
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      // Send/receive the HttpOnly session cookie.
      credentials: "include",
      // Never spin forever if the server hangs.
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw networkError(err);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.message ?? "Something went wrong.", res.status, data.errors, data);
  return data as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { credentials: "include", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw networkError(err);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.message ?? "Something went wrong.", res.status, data.errors, data);
  return data as T;
}
