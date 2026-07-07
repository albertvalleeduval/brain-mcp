/**
 * GitHub repo access for the private brain repo (BRAIN_OWNER/BRAIN_REPO vars).
 *
 * Uses a fine-grained PAT (env.GITHUB_BRAIN_TOKEN) — NOT the user's OAuth token.
 * The OAuth login only proves identity; this token grants repo read/write.
 *
 * Never log or echo the token.
 */

import { cfg } from "./config";

const API = "https://api.github.com";

export interface BrainFile {
  path: string;
  content: string;
  sha: string;
}

export interface BrainIndexEntry {
  path: string;
  summary_l0: string | null;
  summary_l1: string | null;
}

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "GitHubError";
  }
}

/* ---------- base64 helpers (UTF-8 safe) ---------- */

export function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/* ---------- low-level request ---------- */

async function gh(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "brain-mcp",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

function rateLimitMessage(res: Response): string | null {
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = res.headers.get("x-ratelimit-reset");
    const when = reset ? new Date(Number(reset) * 1000).toISOString() : "soon";
    return `GitHub rate limit hit. Resets at ${when}.`;
  }
  return null;
}

/* ---------- reads ---------- */

/** Full recursive tree of the branch. Returns markdown blob paths + shas. */
export async function listTree(
  token: string,
): Promise<{ path: string; sha: string }[]> {
  const res = await gh(
    token,
    "GET",
    `/repos/${cfg().owner}/${cfg().repo}/git/trees/${cfg().branch}?recursive=1`,
  );
  const rl = rateLimitMessage(res);
  if (rl) throw new GitHubError(403, rl);
  if (!res.ok) {
    throw new GitHubError(res.status, `Could not list repo tree (${res.status}).`);
  }
  const data = (await res.json()) as {
    tree: { path: string; type: string; sha: string }[];
    truncated?: boolean;
  };
  return data.tree
    .filter((t) => t.type === "blob" && t.path.toLowerCase().endsWith(".md"))
    .map((t) => ({ path: t.path, sha: t.sha }));
}

/** Read one file by path. Returns null if it does not exist (404). */
export async function getFile(
  token: string,
  path: string,
): Promise<BrainFile | null> {
  const res = await gh(
    token,
    "GET",
    `/repos/${cfg().owner}/${cfg().repo}/contents/${encodePath(path)}?ref=${cfg().branch}`,
  );
  if (res.status === 404) return null;
  const rl = rateLimitMessage(res);
  if (rl) throw new GitHubError(403, rl);
  if (!res.ok) {
    throw new GitHubError(res.status, `Could not read "${path}" (${res.status}).`);
  }
  const data = (await res.json()) as { content?: string; sha: string; type: string };
  if (data.type !== "file" || data.content === undefined) {
    throw new GitHubError(422, `"${path}" is not a readable file.`);
  }
  return { path, content: fromBase64(data.content), sha: data.sha };
}

/**
 * Immutable-blob cache: a git blob's content never changes for a given sha
 * (the sha IS the content hash), so we can cache decoded content forever.
 * Warm isolates skip refetching unchanged files entirely.
 */
const blobCache = new Map<string, string>();
const BLOB_CACHE_MAX = 1000;

function cacheBlob(sha: string, content: string): void {
  if (blobCache.size >= BLOB_CACHE_MAX) blobCache.clear();
  blobCache.set(sha, content);
}

/**
 * Fetch many blobs in ONE GraphQL request per 100 files (aliased fields).
 * The old per-blob REST fan-out blew the Workers subrequest limit (50 on the
 * free plan) once the brain passed ~49 files — every list_brain/search_brain
 * on a cold isolate died with "Too many subrequests".
 */
const GRAPHQL_BATCH = 100;

async function fetchBlobs(
  token: string,
  entries: { path: string; sha: string }[],
): Promise<void> {
  for (let i = 0; i < entries.length; i += GRAPHQL_BATCH) {
    const batch = entries.slice(i, i + GRAPHQL_BATCH);
    const fields = batch
      .map(
        (e, j) =>
          `f${j}: object(expression: ${JSON.stringify(`${cfg().branch}:${e.path}`)}) { ... on Blob { text } }`,
      )
      .join("\n");
    const query = `query { repository(owner: ${JSON.stringify(cfg().owner)}, name: ${JSON.stringify(cfg().repo)}) {\n${fields}\n} }`;

    const res = await fetch(`${API}/graphql`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "brain-mcp",
      },
      body: JSON.stringify({ query }),
    });
    const rl = rateLimitMessage(res);
    if (rl) throw new GitHubError(403, rl);
    if (!res.ok) {
      throw new GitHubError(res.status, `Could not read brain files (GraphQL ${res.status}).`);
    }
    const data = (await res.json()) as {
      data?: { repository?: Record<string, { text: string | null } | null> };
      errors?: { message: string }[];
    };
    const repo = data.data?.repository;
    if (!repo) {
      throw new GitHubError(
        502,
        `Could not read brain files: ${data.errors?.[0]?.message ?? "empty GraphQL response"}.`,
      );
    }
    batch.forEach((e, j) => {
      // text is null only for binary blobs; we filter to .md so treat as empty.
      cacheBlob(e.sha, repo[`f${j}`]?.text ?? "");
    });
  }
}

/** All markdown files with content. Used by list_brain + search_brain. */
export async function getAllFiles(token: string): Promise<BrainFile[]> {
  const tree = await listTree(token);
  const missing = tree.filter((t) => !blobCache.has(t.sha));
  if (missing.length) await fetchBlobs(token, missing);
  return tree.map((t) => ({
    path: t.path,
    sha: t.sha,
    content: blobCache.get(t.sha) ?? "",
  }));
}

/** Recent commits on the branch (newest first). One subrequest per 100. */
export async function listCommits(
  token: string,
  count = 30,
): Promise<{ sha: string; message: string; date: string }[]> {
  const out: { sha: string; message: string; date: string }[] = [];
  const pages = Math.min(5, Math.ceil(count / 100));
  for (let page = 1; page <= pages; page++) {
    const res = await gh(
      token,
      "GET",
      `/repos/${cfg().owner}/${cfg().repo}/commits?sha=${cfg().branch}&per_page=${Math.min(count, 100)}&page=${page}`,
    );
    const rl = rateLimitMessage(res);
    if (rl) throw new GitHubError(403, rl);
    if (!res.ok) throw new GitHubError(res.status, `Could not list commits (${res.status}).`);
    const data = (await res.json()) as {
      sha: string;
      commit: { message: string; committer: { date: string } };
    }[];
    out.push(...data.map((c) => ({ sha: c.sha, message: c.commit.message, date: c.commit.committer.date })));
    if (data.length < 100) break;
  }
  return out.slice(0, count);
}

export interface ReplayFrame {
  sha: string;
  date: string;
  files: string[];
}

/**
 * Markdown file list at each given commit, batched in ONE GraphQL request
 * (tree entries expanded 2 levels — the brain is one folder deep).
 */
export async function listTreesAtCommits(
  token: string,
  commits: { sha: string; date: string }[],
): Promise<ReplayFrame[]> {
  if (!commits.length) return [];
  const fields = commits
    .map(
      (c, i) =>
        `c${i}: object(oid: ${JSON.stringify(c.sha)}) { ... on Commit { tree { entries { name type object { ... on Tree { entries { name type } } } } } } }`,
    )
    .join("\n");
  const query = `query { repository(owner: ${JSON.stringify(cfg().owner)}, name: ${JSON.stringify(cfg().repo)}) {\n${fields}\n} }`;

  const res = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "brain-mcp",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new GitHubError(res.status, `Could not read commit trees (${res.status}).`);

  type Entry = { name: string; type: string; object?: { entries?: { name: string; type: string }[] } | null };
  const data = (await res.json()) as {
    data?: { repository?: Record<string, { tree?: { entries?: Entry[] } } | null> };
    errors?: { message: string }[];
  };
  const repo = data.data?.repository;
  if (!repo) {
    throw new GitHubError(502, `Could not read commit trees: ${data.errors?.[0]?.message ?? "empty response"}.`);
  }

  return commits.map((c, i) => {
    const entries = repo[`c${i}`]?.tree?.entries ?? [];
    const files: string[] = [];
    for (const e of entries) {
      if (e.type === "blob" && e.name.toLowerCase().endsWith(".md")) files.push(e.name);
      if (e.type === "tree") {
        for (const s of e.object?.entries ?? []) {
          if (s.type === "blob" && s.name.toLowerCase().endsWith(".md")) files.push(`${e.name}/${s.name}`);
        }
      }
    }
    return { sha: c.sha, date: c.date, files };
  });
}

/* ---------- writes ---------- */

/**
 * Create or update a file. If `expectedSha` is undefined we look up the
 * current sha first (update) and tolerate 404 (create). GitHub requires the
 * current sha to overwrite an existing file.
 */
export async function putFile(
  token: string,
  path: string,
  content: string,
  message: string,
): Promise<{ created: boolean; commitSha: string }> {
  const existing = await getFile(token, path);
  const body: Record<string, unknown> = {
    message,
    content: toBase64(content),
    branch: cfg().branch,
  };
  if (existing) body.sha = existing.sha;

  const res = await gh(
    token,
    "PUT",
    `/repos/${cfg().owner}/${cfg().repo}/contents/${encodePath(path)}`,
    body,
  );

  if (res.status === 409) {
    throw new GitHubError(
      409,
      `Write conflict on "${path}" (the file changed under me). Retry.`,
    );
  }
  const rl = rateLimitMessage(res);
  if (rl) throw new GitHubError(403, rl);
  if (!res.ok) {
    const detail = await safeText(res);
    throw new GitHubError(res.status, `Write failed for "${path}" (${res.status}). ${detail}`);
  }
  const data = (await res.json()) as { commit: { sha: string } };
  return { created: !existing, commitSha: data.commit.sha };
}

/** Delete a file (requires its current sha, like any GitHub contents write). */
export async function deleteFile(
  token: string,
  path: string,
  message: string,
): Promise<{ commitSha: string }> {
  const existing = await getFile(token, path);
  if (!existing) throw new GitHubError(404, `No file at "${path}".`);

  const res = await gh(token, "DELETE", `/repos/${cfg().owner}/${cfg().repo}/contents/${encodePath(path)}`, {
    message,
    sha: existing.sha,
    branch: cfg().branch,
  });
  const rl = rateLimitMessage(res);
  if (rl) throw new GitHubError(403, rl);
  if (!res.ok) {
    const detail = await safeText(res);
    throw new GitHubError(res.status, `Delete failed for "${path}" (${res.status}). ${detail}`);
  }
  const data = (await res.json()) as { commit: { sha: string } };
  return { commitSha: data.commit.sha };
}

async function safeText(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { message?: string };
    return j.message ?? "";
  } catch {
    return "";
  }
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/* ---------- frontmatter ---------- */

/** Extract the YAML frontmatter block (between leading --- fences). */
export function splitFrontmatter(content: string): {
  frontmatter: string | null;
  body: string;
} {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { frontmatter: null, body: content };
  return { frontmatter: m[1], body: m[2] };
}

/** Read a single scalar key from a frontmatter block. */
export function readFrontmatterKey(frontmatter: string, key: string): string | null {
  const re = new RegExp(`^${key}\\s*:\\s*(.*)$`, "m");
  const m = frontmatter.match(re);
  if (!m) return null;
  return m[1].trim().replace(/^["']|["']$/g, "") || null;
}

/** Set/replace a scalar key in a frontmatter block (adds it if absent). */
export function setFrontmatterKey(frontmatter: string, key: string, value: string): string {
  const re = new RegExp(`^(${key}\\s*:).*$`, "m");
  if (re.test(frontmatter)) {
    return frontmatter.replace(re, `$1 ${value}`);
  }
  return `${frontmatter.replace(/\s*$/, "")}\n${key}: ${value}`;
}

export function buildFrontmatter(fm: string, body: string): string {
  return `---\n${fm.replace(/\r?\n$/, "")}\n---\n\n${body.replace(/^\s+/, "")}`;
}

export function summariesOf(content: string): {
  summary_l0: string | null;
  summary_l1: string | null;
} {
  const { frontmatter } = splitFrontmatter(content);
  if (!frontmatter) return { summary_l0: null, summary_l1: null };
  return {
    summary_l0: readFrontmatterKey(frontmatter, "summary_l0"),
    summary_l1: readFrontmatterKey(frontmatter, "summary_l1"),
  };
}
