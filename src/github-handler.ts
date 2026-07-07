/**
 * GitHub OAuth "login" handler mounted as the OAuthProvider defaultHandler.
 *
 * Flow:
 *  claude.ai -> /authorize -> (redirect to GitHub) -> GitHub -> /callback
 *  -> verify identity is ALLOWED_LOGIN -> completeAuthorization -> back to claude.ai
 *
 * The GitHub OAuth token obtained here proves WHO the user is. It is not used
 * for repo access — repo read/write uses the server's own GITHUB_BRAIN_TOKEN.
 */

import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { getUpstreamAuthorizeUrl, fetchUpstreamAuthToken, encodeState, decodeState } from "./utils";
import { cfg } from "./config";
import { browserApp, completeBrowserLogin, type BrowserState } from "./api";
import type { Props } from "./types";

type Bindings = Env & { OAUTH_PROVIDER: OAuthHelpers };

const app = new Hono<{ Bindings: Bindings }>();

// Browser surface: /app/* + session-gated /api/*.
app.route("/", browserApp);

app.get("/authorize", async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  if (!oauthReqInfo.clientId) {
    return c.text("Invalid authorization request.", 400);
  }
  const redirectUri = new URL("/callback", c.req.url).href;
  return Response.redirect(
    getUpstreamAuthorizeUrl({
      upstreamUrl: "https://github.com/login/oauth/authorize",
      clientId: c.env.GITHUB_CLIENT_ID,
      scope: "read:user",
      redirectUri,
      state: encodeState(oauthReqInfo),
    }),
    302,
  );
});

app.get("/callback", async (c) => {
  const stateParam = c.req.query("state");
  const code = c.req.query("code");
  if (!stateParam || !code) {
    return c.text("Missing code or state.", 400);
  }

  let decoded: AuthRequest | BrowserState;
  try {
    decoded = decodeState<AuthRequest | BrowserState>(stateParam);
  } catch {
    return c.text("Invalid state.", 400);
  }

  // Browser login (started at /app/login) shares this callback URL; the
  // state's mode marker tells the two flows apart.
  if ((decoded as BrowserState).mode === "browser") {
    return completeBrowserLogin(c, decoded as BrowserState, code);
  }

  const oauthReqInfo = decoded as AuthRequest;
  if (!oauthReqInfo.clientId) {
    return c.text("Invalid state.", 400);
  }

  const redirectUri = new URL("/callback", c.req.url).href;
  const [accessToken, errRes] = await fetchUpstreamAuthToken({
    clientId: c.env.GITHUB_CLIENT_ID,
    clientSecret: c.env.GITHUB_CLIENT_SECRET,
    code,
    redirectUri,
  });
  if (errRes) return errRes;

  // Fetch the GitHub identity behind this token.
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "brain-mcp",
    },
  });
  if (!userRes.ok) {
    return c.text("Could not read GitHub identity.", 502);
  }
  const user = (await userRes.json()) as { login: string; name: string | null; email: string | null };

  // Single-user gate.
  if (user.login !== cfg().allowedLogin) {
    return c.text(
      `Access denied. This connector is private to @${cfg().allowedLogin}.`,
      403,
    );
  }

  const props: Props = {
    login: user.login,
    name: user.name ?? user.login,
    email: user.email ?? "",
  };

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: user.login,
    metadata: { label: props.name },
    scope: oauthReqInfo.scope,
    props,
  });

  return Response.redirect(redirectTo, 302);
});

export { app as GitHubHandler };
