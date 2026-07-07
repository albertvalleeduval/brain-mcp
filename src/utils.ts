/** Upstream (GitHub) OAuth helpers for the login handshake. */

export function getUpstreamAuthorizeUrl(opts: {
  upstreamUrl: string;
  clientId: string;
  scope: string;
  redirectUri: string;
  state: string;
}): string {
  const u = new URL(opts.upstreamUrl);
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("scope", opts.scope);
  u.searchParams.set("state", opts.state);
  u.searchParams.set("response_type", "code");
  return u.href;
}

/**
 * Exchange an authorization code for a GitHub access token.
 * Returns [token, null] on success or [null, Response] on failure.
 */
export async function fetchUpstreamAuthToken(opts: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<[string | null, Response | null]> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "brain-mcp",
    },
    body: new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code: opts.code,
      redirect_uri: opts.redirectUri,
    }).toString(),
  });
  if (!res.ok) {
    return [null, new Response("Failed to exchange code for token.", { status: 502 })];
  }
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) {
    return [null, new Response(`GitHub token error: ${data.error ?? "unknown"}.`, { status: 400 })];
  }
  return [data.access_token, null];
}

/** UTF-8 safe base64 for opaque state passing. */
export function encodeState(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function decodeState<T>(state: string): T {
  const bin = atob(state);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
