/** MCP tool registrations: 3 read tools + 5 intent-shaped write tools. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getAllFiles,
  getFile,
  summariesOf,
  splitFrontmatter,
  buildFrontmatter,
  setFrontmatterKey,
  GitHubError,
} from "./brain";
import { detectSecret, normalizePath } from "./guards";
import { buildGraph, buildHealth, renderHealth } from "./graph";
import {
  stageToInbox,
  deleteInboxItem,
  upsertFile,
  updateNow,
  appendDecision as appendDecisionOp,
} from "./ops";
import { todayLocal as today } from "./dates";

type TextResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(text: string): TextResult {
  return { content: [{ type: "text", text }] };
}
function fail(text: string): TextResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** Wrap a tool body so GitHub/guard errors become clean tool errors, never crashes. */
async function guarded(fn: () => Promise<TextResult>): Promise<TextResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GitHubError) return fail(e.message);
    return fail(`Unexpected error: ${(e as Error).message}`);
  }
}


function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Ensure content has a frontmatter block; add a minimal one if missing. */
function ensureFrontmatter(content: string, defaults: Record<string, string>): string {
  const { frontmatter, body } = splitFrontmatter(content);
  if (frontmatter !== null) return content;
  const fm = Object.entries(defaults)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return buildFrontmatter(fm, body);
}

export function registerTools(server: McpServer, getToken: () => string): void {
  /* ============================ READ ============================ */

  server.tool(
    "list_brain",
    "List every markdown file in the brain with its frontmatter summary_l0 (one line) and summary_l1 (short paragraph). This is the cheap index — call it FIRST, then pull full files only when relevant.",
    async () =>
      guarded(async () => {
        const files = await getAllFiles(getToken());
        files.sort((a, b) => a.path.localeCompare(b.path));
        const lines = files.map((f) => {
          const { summary_l0, summary_l1 } = summariesOf(f.content);
          const l0 = summary_l0 ? ` — ${summary_l0}` : "";
          const l1 = summary_l1 ? `\n    ${summary_l1}` : "";
          return `- ${f.path}${l0}${l1}`;
        });
        return ok(
          `Brain index (${files.length} files). Read full files with get_brain_file(path).\n\n${lines.join("\n")}`,
        );
      }),
  );

  server.tool(
    "get_brain_file",
    "Return the full content of one brain file by its path (e.g. 'identity.md' or 'projects/my-startup.md').",
    { path: z.string().describe("Repo-relative path, e.g. 'now.md' or 'context/my-company.md'") },
    async ({ path }) =>
      guarded(async () => {
        const file = await getFile(getToken(), normalizePath(path));
        if (!file) return fail(`No file at "${path}".`);
        return ok(file.content);
      }),
  );

  server.tool(
    "search_brain",
    "Plain-text search across all brain files (frontmatter + body). Returns matching paths with snippets. No embeddings.",
    { query: z.string().describe("Text to search for (case-insensitive)") },
    async ({ query }) =>
      guarded(async () => {
        const q = query.trim().toLowerCase();
        if (!q) return fail("Empty query.");
        const files = await getAllFiles(getToken());
        const hits: string[] = [];
        for (const f of files) {
          const idx = f.content.toLowerCase().indexOf(q);
          if (idx === -1) continue;
          const start = Math.max(0, idx - 60);
          const end = Math.min(f.content.length, idx + q.length + 60);
          const snippet = f.content
            .slice(start, end)
            .replace(/\s+/g, " ")
            .trim();
          hits.push(`- ${f.path}: …${snippet}…`);
        }
        if (!hits.length) return ok(`No matches for "${query}".`);
        return ok(`${hits.length} match(es) for "${query}":\n\n${hits.join("\n")}`);
      }),
  );

  server.tool(
    "get_graph",
    "Return the brain's link graph as JSON: nodes (every file with id/type/tags/status/updated/degrees) and edges (resolved [[wiki-links]]), plus brokenLinks ([[targets]] that resolve to no file — seams to fill). Use it to reason about connections without reading every file.",
    async () =>
      guarded(async () => {
        const graph = buildGraph(await getAllFiles(getToken()));
        return ok(JSON.stringify(graph));
      }),
  );

  server.tool(
    "brain_health",
    "Audit the brain: broken [[links]], orphan files (no inbound links), stale active/volatile files past their per-folder TTL (now.md 14d, context/ 90d, people/ projects/ personal/ 180d), files missing summary_l0, and inbox items awaiting ingestion. Run it at the start of maintenance sessions.",
    async () =>
      guarded(async () => {
        const graph = buildGraph(await getAllFiles(getToken()));
        return ok(renderHealth(buildHealth(graph, today())));
      }),
  );

  /* ============================ WRITE ============================ */

  server.tool(
    "add_to_inbox",
    "Stage a raw note into inbox/ for later classification per ingestion-protocol.md. Safe for anything ambiguous. Never overwrites an existing file.",
    {
      filename: z.string().describe("File name only, e.g. 'idea-pricing.md' (no folders)"),
      content: z.string().describe("Raw content to stage"),
    },
    async ({ filename, content }) =>
      guarded(async () => {
        const res = await stageToInbox(getToken(), filename, content);
        return ok(`Staged to ${res.path} (commit ${res.commitSha.slice(0, 7)}). Classify later per ingestion-protocol.md.`);
      }),
  );

  server.tool(
    "delete_inbox_item",
    "Remove a processed item from inbox/ after ingestion (ingestion-protocol step 5: trace, then clean). ONLY works on inbox/ — nothing else in the brain is deletable through the MCP.",
    { filename: z.string().describe("File name inside inbox/, e.g. 'idea-pricing.md' (no folders)") },
    async ({ filename }) =>
      guarded(async () => {
        const res = await deleteInboxItem(getToken(), filename);
        return ok(`Deleted ${res.path} (commit ${res.commitSha.slice(0, 7)}).`);
      }),
  );

  server.tool(
    "append_decision",
    "Append a dated entry to the current month's decisions/YYYY-MM.md. APPEND-ONLY: never rewrites past entries. Creates the month file if absent.",
    { text: z.string().describe("The decision to record") },
    async ({ text }) =>
      guarded(async () => {
        const res = await appendDecisionOp(getToken(), text);
        return ok(
          `${res.created ? "Created" : "Appended to"} ${res.path} (commit ${res.commitSha.slice(0, 7)}).`,
        );
      }),
  );

  server.tool(
    "update_now",
    "Replace the body of now.md and bump its 'updated' frontmatter date. Pass summary_l0/summary_l1 whenever the focus changes so the file index stays in sync with the body.",
    {
      content: z.string().describe("New body for now.md (markdown, no frontmatter needed)"),
      summary_l0: z
        .string()
        .optional()
        .describe("One-line summary of the current focus for the file index. Provide when the focus changed."),
      summary_l1: z
        .string()
        .optional()
        .describe("Short paragraph summary. Provide when the focus changed."),
    },
    async ({ content, summary_l0, summary_l1 }) =>
      guarded(async () => {
        const res = await updateNow(getToken(), content, summary_l0, summary_l1);
        return ok(`${res.created ? "Created" : "Updated"} now.md (commit ${res.commitSha.slice(0, 7)}).`);
      }),
  );

  server.tool(
    "upsert_project",
    "Create or update projects/<name>.md with proper frontmatter.",
    {
      name: z.string().describe("Project name, e.g. 'website-redesign' or 'Q3 Launch'"),
      content: z.string().describe("Full markdown body (frontmatter optional; added if missing)"),
    },
    async ({ name, content }) =>
      guarded(async () => {
        const secret = detectSecret(content);
        if (secret) return fail(`Refused: content looks like a secret (${secret}). Not written.`);
        const slug = slugify(name);
        if (!slug) return fail(`Could not derive a filename from "${name}".`);
        const path = `projects/${slug}.md`;

        let body = ensureFrontmatter(content, {
          id: `project-${slug}`,
          type: "project",
          tags: "[project]",
          status: "active",
          summary_l0: `Project: ${name}.`,
          summary_l1: `Notes and state for the ${name} project.`,
          updated: today(),
        });
        // Always refresh the updated date if a frontmatter block exists.
        const split = splitFrontmatter(body);
        if (split.frontmatter) {
          body = buildFrontmatter(setFrontmatterKey(split.frontmatter, "updated", today()), split.body);
        }

        const res = await upsertFile(getToken(), path, body);
        return ok(`${res.created ? "Created" : "Updated"} ${res.path} (commit ${res.commitSha.slice(0, 7)}).`);
      }),
  );

  server.tool(
    "upsert_file",
    "General fallback: create or update a markdown file at a given brain path. Refuses paths outside the brain's known folders and refuses content that looks like a secret. Follow brain-protocol.md.",
    {
      path: z.string().describe("Repo-relative .md path within an allowed folder"),
      content: z.string().describe("Full file content"),
    },
    async ({ path, content }) =>
      guarded(async () => {
        const res = await upsertFile(getToken(), path, content);
        return ok(`${res.created ? "Created" : "Updated"} ${res.path} (commit ${res.commitSha.slice(0, 7)}).`);
      }),
  );
}
