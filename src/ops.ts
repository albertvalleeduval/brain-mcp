/**
 * Intent-shaped operations shared by the MCP tools and the browser API,
 * so both surfaces enforce the exact same guards.
 */

import {
  getFile,
  putFile,
  deleteFile,
  splitFrontmatter,
  buildFrontmatter,
  setFrontmatterKey,
  GitHubError,
} from "./brain";
import { checkFilename, checkPath, detectSecret, normalizePath } from "./guards";
import { todayLocal as today, currentMonthLocal as currentMonth } from "./dates";

/** Stage a raw note into inbox/ (dumb capture — never overwrites). */
export async function stageToInbox(
  token: string,
  filename: string,
  content: string,
): Promise<{ path: string; commitSha: string }> {
  const fn = checkFilename(filename);
  if (!fn.ok) throw new GitHubError(400, fn.reason!);
  const secret = detectSecret(content);
  if (secret) throw new GitHubError(400, `Refused: content looks like a secret (${secret}). Not written.`);

  let name = filename.trim();
  if (!name.toLowerCase().endsWith(".md")) name += ".md";
  const path = `inbox/${name}`;

  const existing = await getFile(token, path);
  if (existing) {
    throw new GitHubError(409, `"${path}" already exists. inbox is append-safe only; pick another name.`);
  }

  const res = await putFile(token, path, content, `inbox: add ${name}`);
  return { path, commitSha: res.commitSha };
}

/**
 * Remove a processed item from inbox/. Hard-restricted to inbox/ — this is
 * the ONLY delete the server exposes; everything else in the brain is
 * delete-by-human-only (brain-protocol.md).
 */
export async function deleteInboxItem(
  token: string,
  filename: string,
): Promise<{ path: string; commitSha: string }> {
  const fn = checkFilename(filename);
  if (!fn.ok) throw new GitHubError(400, fn.reason!);

  const name = filename.trim();
  const path = `inbox/${name}`;
  const res = await deleteFile(token, path, `inbox: clear ${name} (ingested)`);
  return { path, commitSha: res.commitSha };
}

/**
 * Create or update a markdown file at a brain path. Same guards as the
 * upsert_file MCP tool: allowed folders only, no secrets, decisions/ is
 * append-only (use appendDecision).
 */
export async function upsertFile(
  token: string,
  rawPath: string,
  content: string,
): Promise<{ path: string; commitSha: string; created: boolean }> {
  const check = checkPath(rawPath, { requireMarkdown: true });
  if (!check.ok) throw new GitHubError(400, `Refused: ${check.reason}`);
  const clean = normalizePath(rawPath);
  if (clean.startsWith("decisions/")) {
    throw new GitHubError(400, "decisions/ is append-only. Use append_decision, not a full overwrite.");
  }
  const secret = detectSecret(content);
  if (secret) throw new GitHubError(400, `Refused: content looks like a secret (${secret}). Not written.`);

  const res = await putFile(token, clean, content, `upsert ${clean}`);
  return { path: clean, commitSha: res.commitSha, created: res.created };
}

/** Replace now.md's body, bump `updated`, optionally refresh its summaries. */
export async function updateNow(
  token: string,
  content: string,
  summary_l0?: string,
  summary_l1?: string,
): Promise<{ path: string; commitSha: string; created: boolean }> {
  const secret = detectSecret(content);
  if (secret) throw new GitHubError(400, `Refused: content looks like a secret (${secret}). Not written.`);

  const fallback = `id: now\ntype: core\ntags: [now, focus, volatile]\nstatus: volatile\nsummary_l0: Current focus.\nsummary_l1: What I'm working on right now.\nupdated: ${today()}`;
  const existing = await getFile(token, "now.md");
  let fm = existing ? splitFrontmatter(existing.content).frontmatter ?? fallback : fallback;
  fm = setFrontmatterKey(fm, "updated", today());
  if (summary_l0 !== undefined) fm = setFrontmatterKey(fm, "summary_l0", summary_l0);
  if (summary_l1 !== undefined) fm = setFrontmatterKey(fm, "summary_l1", summary_l1);
  const newContent = buildFrontmatter(fm, content.trim() + "\n");

  const res = await putFile(token, "now.md", newContent, `now: update ${today()}`);
  return { path: "now.md", commitSha: res.commitSha, created: res.created };
}

/** Append a dated entry to the current month's decisions log (never rewrites). */
export async function appendDecision(
  token: string,
  text: string,
): Promise<{ path: string; commitSha: string; created: boolean }> {
  const secret = detectSecret(text);
  if (secret) throw new GitHubError(400, `Refused: content looks like a secret (${secret}). Not written.`);

  const month = currentMonth();
  const path = `decisions/${month}.md`;
  const entry = `## ${today()}\n\n${text.trim()}\n`;

  const existing = await getFile(token, path);
  let newContent: string;
  if (existing) {
    newContent = `${existing.content.replace(/\s*$/, "")}\n\n${entry}`;
  } else {
    const fm = `---\nid: decision-${month}\ntype: decision\ntags: [journal, decisions]\nstatus: active\nsummary_l0: Decisions logged in ${month}.\nsummary_l1: Append-only decision log for ${month}.\nupdated: ${today()}\n---\n\n# Decisions — ${month}\n\n`;
    newContent = `${fm}${entry}`;
  }

  const res = await putFile(token, path, newContent, `decision: ${today()}`);
  return { path, commitSha: res.commitSha, created: res.created };
}
