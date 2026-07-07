/**
 * Browser-facing surface: GitHub-gated session + JSON API for the web app.
 *
 *   GET  /app/login   -> GitHub OAuth (state {mode:"browser"}) -> /callback
 *   GET  /app/logout
 *   GET  /app         -> placeholder until the UI ships (phase 3)
 *   GET  /api/me      -> {login}
 *   GET  /api/graph   -> BrainGraph JSON (nodes, edges, brokenLinks)
 *   GET  /api/health  -> HealthReport JSON
 *   GET  /api/file    -> ?path=now.md -> {path, content}
 *   POST /api/inbox   -> {filename, content} -> staged (dumb capture, no LLM)
 *
 * Auth model: same single-user GitHub gate as the MCP flow. A successful
 * login stores a random session id in OAUTH_KV (30 days) behind an HttpOnly
 * cookie. CSRF: SameSite=Lax + the Origin check in index.ts + JSON-only body.
 */

import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Context } from "hono";
import { getAllFiles, getFile, listCommits, listTreesAtCommits, GitHubError, type ReplayFrame } from "./brain";
import { buildGraph, buildHealth } from "./graph";
import { stageToInbox, deleteInboxItem, upsertFile, updateNow, appendDecision } from "./ops";
import { todayLocal, timeLocal } from "./dates";
import { cfg } from "./config";
import {
  getUpstreamAuthorizeUrl,
  fetchUpstreamAuthToken,
  encodeState,
} from "./utils";

export type ApiBindings = Env & { OAUTH_PROVIDER: OAuthHelpers };
type Ctx = Context<{ Bindings: ApiBindings }>;

export interface BrowserState {
  mode: "browser";
  nonce: string;
}

const SESSION_TTL_S = 30 * 24 * 60 * 60; // 30 days
const NONCE_TTL_S = 600;
const SESSION_COOKIE = "bsess";
const NONCE_COOKIE = "bnonce";

const cookieOpts = { httpOnly: true, secure: true, sameSite: "Lax" as const, path: "/" };

async function sessionLogin(c: Ctx): Promise<string | null> {
  const id = getCookie(c, SESSION_COOKIE);
  if (!id) return null;
  return await c.env.OAUTH_KV.get(`bsess:${id}`);
}

/** Finish a browser login begun at /app/login. Called from the shared /callback. */
export async function completeBrowserLogin(
  c: Ctx,
  state: BrowserState,
  code: string,
): Promise<Response> {
  const nonce = getCookie(c, NONCE_COOKIE);
  if (!nonce || nonce !== state.nonce) {
    return c.text("Login expired or state mismatch. Retry from /app/login.", 400);
  }
  deleteCookie(c, NONCE_COOKIE, { path: "/" });

  const redirectUri = new URL("/callback", c.req.url).href;
  const [accessToken, errRes] = await fetchUpstreamAuthToken({
    clientId: c.env.GITHUB_CLIENT_ID,
    clientSecret: c.env.GITHUB_CLIENT_SECRET,
    code,
    redirectUri,
  });
  if (errRes) return errRes;

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "brain-mcp",
    },
  });
  if (!userRes.ok) return c.text("Could not read GitHub identity.", 502);
  const user = (await userRes.json()) as { login: string };

  if (user.login !== cfg().allowedLogin) {
    return c.text(`Access denied. This app is private to @${cfg().allowedLogin}.`, 403);
  }

  const id = crypto.randomUUID();
  await c.env.OAUTH_KV.put(`bsess:${id}`, user.login, { expirationTtl: SESSION_TTL_S });
  setCookie(c, SESSION_COOKIE, id, { ...cookieOpts, maxAge: SESSION_TTL_S });
  return c.redirect("/", 302);
}

export const browserApp = new Hono<{ Bindings: ApiBindings }>();

/* ---------- /app (login + placeholder) ---------- */

browserApp.get("/app/login", (c) => {
  const nonce = crypto.randomUUID();
  setCookie(c, NONCE_COOKIE, nonce, { ...cookieOpts, maxAge: NONCE_TTL_S });
  const state: BrowserState = { mode: "browser", nonce };
  return c.redirect(
    getUpstreamAuthorizeUrl({
      upstreamUrl: "https://github.com/login/oauth/authorize",
      clientId: c.env.GITHUB_CLIENT_ID,
      scope: "read:user",
      redirectUri: new URL("/callback", c.req.url).href,
      state: encodeState(state),
    }),
    302,
  );
});

browserApp.get("/app/logout", async (c) => {
  const id = getCookie(c, SESSION_COOKIE);
  if (id) await c.env.OAUTH_KV.delete(`bsess:${id}`);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.text("Logged out.");
});

// The SPA is served from static assets at "/"; /app just redirects there.
browserApp.get("/app", (c) => c.redirect("/", 302));

/* ---------- /api (session-gated JSON) ---------- */

browserApp.use("/api/*", async (c, next) => {
  const login = await sessionLogin(c as Ctx);
  if (login !== cfg().allowedLogin) {
    return c.json({ error: "unauthorized", login: "/app/login" }, 401);
  }
  await next();
});

browserApp.get("/api/me", async (c) => c.json({ login: cfg().allowedLogin }));

browserApp.get("/api/graph", async (c) => {
  const graph = buildGraph(await getAllFiles(c.env.GITHUB_BRAIN_TOKEN));
  return c.json({ ...graph, centerPath: cfg().centerPath || null });
});

browserApp.get("/api/health", async (c) => {
  const graph = buildGraph(await getAllFiles(c.env.GITHUB_BRAIN_TOKEN));
  return c.json(buildHealth(graph, todayLocal()));
});

browserApp.get("/api/history", async (c) => {
  return c.json(await listCommits(c.env.GITHUB_BRAIN_TOKEN));
});

/**
 * Replay timeline: the brain's file list at up to 40 evenly-sampled commits,
 * oldest → newest. 1 REST req per 100 commits + 1 GraphQL req for ALL trees.
 * Cached per head sha (immutable history).
 */
const REPLAY_FRAMES = 40;
let replayCache: { head: string; frames: ReplayFrame[] } | null = null;

browserApp.get("/api/replay", async (c) => {
  const commits = await listCommits(c.env.GITHUB_BRAIN_TOKEN, 500);
  if (!commits.length) return c.json({ frames: [] });
  if (replayCache?.head === commits[0].sha) return c.json({ frames: replayCache.frames });

  const chrono = [...commits].reverse();
  const sampled =
    chrono.length <= REPLAY_FRAMES
      ? chrono
      : Array.from({ length: REPLAY_FRAMES }, (_, i) =>
          chrono[Math.round((i * (chrono.length - 1)) / (REPLAY_FRAMES - 1))],
        );
  const frames = await listTreesAtCommits(c.env.GITHUB_BRAIN_TOKEN, sampled);
  replayCache = { head: commits[0].sha, frames };
  return c.json({ frames });
});

/** Full-text search: paths whose BODY contains q. Feeds the UI's secondary
 *  match tier (title/path matches stay the primary tier, computed client-side). */
browserApp.get("/api/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  if (q.length < 3) return c.json({ paths: [] });
  const files = await getAllFiles(c.env.GITHUB_BRAIN_TOKEN);
  const paths = files.filter((f) => f.content.toLowerCase().includes(q)).map((f) => f.path);
  return c.json({ paths });
});

browserApp.get("/api/file", async (c) => {
  const raw = c.req.query("path") ?? "";
  const path = raw.trim().replace(/^\.?\//, "");
  if (!path || path.includes("..") || path.includes("\\") || !path.toLowerCase().endsWith(".md")) {
    return c.json({ error: "invalid path" }, 400);
  }
  const file = await getFile(c.env.GITHUB_BRAIN_TOKEN, path);
  if (!file) return c.json({ error: `no file at "${path}"` }, 404);
  return c.json({ path: file.path, content: file.content });
});

/**
 * PWA share target (manifest.webmanifest): Android/desktop "share to my²brain"
 * POSTs title/text/url here as multipart form data. Dumb capture → inbox/,
 * zero LLM, per ingestion-protocol. Text-only for now (files need the
 * non-.md inbox guard relaxation — later).
 */
browserApp.get("/share", (c) => c.redirect("/", 302));
browserApp.post("/share", async (c) => {
  const login = await sessionLogin(c as Ctx);
  if (login !== cfg().allowedLogin) return c.redirect("/app/login", 302);

  const form = await c.req.formData();
  const title = String(form.get("title") ?? "").trim();
  const text = String(form.get("text") ?? "").trim();
  const url = String(form.get("url") ?? "").trim();
  if (!title && !text && !url) return c.redirect("/", 302);

  const body = [
    title ? `# ${title}` : "",
    text,
    url ? `Source : ${url}` : "",
    `\n> Capturé via PWA share le ${todayLocal()}.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const base = `capture-${todayLocal()}-${timeLocal()}`;
  try {
    try {
      await stageToInbox(c.env.GITHUB_BRAIN_TOKEN, `${base}.md`, body);
    } catch (e) {
      // same-minute collision → suffix and retry once
      if (e instanceof GitHubError && e.status === 409) {
        await stageToInbox(c.env.GITHUB_BRAIN_TOKEN, `${base}-${crypto.randomUUID().slice(0, 4)}.md`, body);
      } else throw e;
    }
  } catch (e) {
    if (e instanceof GitHubError) return c.text(`Capture refusée : ${e.message}`, e.status as 400);
    throw e;
  }
  return c.redirect("/?staged=1", 303);
});

browserApp.post("/api/inbox", async (c) => {
  let body: { filename?: string; content?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "expected JSON body {filename, content}" }, 400);
  }
  if (!body.filename || !body.content) {
    return c.json({ error: "filename and content are required" }, 400);
  }
  try {
    const res = await stageToInbox(c.env.GITHUB_BRAIN_TOKEN, body.filename, body.content);
    return c.json({ staged: res.path, commit: res.commitSha });
  } catch (e) {
    if (e instanceof GitHubError) return c.json({ error: e.message }, e.status as 400);
    throw e;
  }
});

/* ---------- writes (session-gated by the /api/* middleware above) ---------- */

async function json<T>(c: Ctx): Promise<T | null> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return null;
  }
}
function writeError(c: Ctx, e: unknown): Response {
  if (e instanceof GitHubError) return c.json({ error: e.message }, e.status as 400);
  throw e;
}

/** Create or update a markdown file (upsert_file guards: allowed folders, no
 *  secrets, decisions/ refused). */
browserApp.put("/api/file", async (c) => {
  const body = await json<{ path?: string; content?: string }>(c as Ctx);
  if (!body?.path || body.content === undefined) {
    return c.json({ error: "path and content are required" }, 400);
  }
  try {
    const res = await upsertFile(c.env.GITHUB_BRAIN_TOKEN, body.path, body.content);
    return c.json({ path: res.path, commit: res.commitSha, created: res.created });
  } catch (e) {
    return writeError(c as Ctx, e);
  }
});

/** Replace now.md's body (+ optional summaries). */
browserApp.post("/api/now", async (c) => {
  const body = await json<{ content?: string; summary_l0?: string; summary_l1?: string }>(c as Ctx);
  if (body?.content === undefined) return c.json({ error: "content is required" }, 400);
  try {
    const res = await updateNow(c.env.GITHUB_BRAIN_TOKEN, body.content, body.summary_l0, body.summary_l1);
    return c.json({ path: res.path, commit: res.commitSha });
  } catch (e) {
    return writeError(c as Ctx, e);
  }
});

/** Append a dated decision (append-only). */
browserApp.post("/api/decision", async (c) => {
  const body = await json<{ text?: string }>(c as Ctx);
  if (!body?.text) return c.json({ error: "text is required" }, 400);
  try {
    const res = await appendDecision(c.env.GITHUB_BRAIN_TOKEN, body.text);
    return c.json({ path: res.path, commit: res.commitSha, created: res.created });
  } catch (e) {
    return writeError(c as Ctx, e);
  }
});

/** Delete a processed inbox item (restricted to inbox/). */
browserApp.post("/api/inbox/delete", async (c) => {
  const body = await json<{ filename?: string }>(c as Ctx);
  if (!body?.filename) return c.json({ error: "filename is required" }, 400);
  try {
    const res = await deleteInboxItem(c.env.GITHUB_BRAIN_TOKEN, body.filename);
    return c.json({ deleted: res.path, commit: res.commitSha });
  } catch (e) {
    return writeError(c as Ctx, e);
  }
});
