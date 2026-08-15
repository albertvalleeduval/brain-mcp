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
import { todayLocal as today, currentMonthLocal as currentMonth, clockLocal as clock } from "./dates";

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

  // Create-only expectation: should the name get taken right after the check
  // above, the write 409s rather than clobbering the other note.
  const res = await putFile(token, path, content, `inbox: add ${name}`, null);
  return { path, commitSha: res.commitSha };
}

/**
 * Append one captured idea to today's inbox day-file (dumb capture, no LLM).
 *
 * One file per day rather than one file per idea: a day of captures reads as
 * a list, and triage opens one file instead of twenty. Format is `- HH:MM
 * text`, continuation lines indented by two spaces so a multi-line capture
 * stays ONE markdown item.
 *
 * `kind` is an optional pre-assignment made at capture time, while the
 * context is still in mind — `- 14:32 [todo] call the accountant`. It does
 * not replace triage, it spares it a guess. Whitelisted: an arbitrary string
 * must never reach the file.
 */
const IDEA_KINDS = new Set(["todo", "reflexion", "projet", "question"]);

export async function appendIdea(
  token: string,
  text: string,
  kind?: string,
): Promise<{ path: string; commitSha: string; line: string }> {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  if (!clean) throw new GitHubError(400, "Empty capture.");
  if (clean.length > 4000) throw new GitHubError(413, "Capture too long (4000 characters max).");
  const secret = detectSecret(clean);
  if (secret) throw new GitHubError(400, `Refused: content looks like a secret (${secret}). Not written.`);

  const day = today();
  const path = `inbox/idees-${day}.md`;

  const k = (kind ?? "").trim().toLowerCase();
  if (k && !IDEA_KINDS.has(k)) throw new GitHubError(400, `Unknown kind "${k}".`);
  const mark = k ? `[${k}] ` : "";

  const lines = clean.split("\n").map((l) => l.trim());
  let entry = `- ${clock()} ${mark}${lines[0]}\n`;
  for (const l of lines.slice(1)) if (l) entry += `  ${l}\n`;

  // Read-modify-write: another capture may land between the read and the put.
  // Passing the sha WE read makes putFile 409 on that race (instead of
  // re-reading the sha itself and silently dropping the interleaved line),
  // so re-read and retry.
  for (let attempt = 0; ; attempt++) {
    const existing = await getFile(token, path);
    const base = existing?.content ?? `# Idées du ${day}\n\n`;
    const next = (base.endsWith("\n") ? base : `${base}\n`) + entry;
    try {
      const res = await putFile(token, path, next, `inbox: capture (${day})`, existing ? existing.sha : null);
      return { path, commitSha: res.commitSha, line: entry.trim() };
    } catch (e) {
      if (e instanceof GitHubError && e.status === 409 && attempt < 3) continue;
      throw e;
    }
  }
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

  const res = await putFile(token, "now.md", newContent, `now: update ${today()}`, existing ? existing.sha : null);
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

  const res = await putFile(token, path, newContent, `decision: ${today()}`, existing ? existing.sha : null);
  return { path, commitSha: res.commitSha, created: res.created };
}
