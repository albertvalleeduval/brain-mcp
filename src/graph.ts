/**
 * Graph + health analysis over the brain's markdown files.
 *
 * Pure functions over BrainFile[] — no fetching here. Both the MCP tools
 * (get_graph / brain_health) and the browser API (/api/graph, /api/health)
 * consume these, so the two surfaces can never drift apart.
 */

import type { BrainFile } from "./brain";
import { splitFrontmatter, readFrontmatterKey } from "./brain";

export interface GraphNode {
  path: string;
  /** Display title: first `# heading`, else the filename prettified (dashes → spaces). */
  title: string;
  id: string | null;
  type: string | null;
  tags: string[];
  status: string | null;
  updated: string | null;
  summary_l0: string | null;
  folder: string;
  size: number;
  inDegree: number;
  outDegree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

/** A [[link]] whose target resolves to no file — a seam to fill, not an error. */
export interface BrokenLink {
  source: string;
  target: string;
}

export interface BrainGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  brokenLinks: BrokenLink[];
}

const WIKI_LINK = /\[\[([^\[\]]+)\]\]/g;

/**
 * Wiki-links quoted as notation — inside inline code spans or fenced code
 * blocks — are examples, not edges (e.g. brain-protocol explaining the
 * `[[...]]` syntax). Strip code before scanning so they never count.
 */
function stripCode(content: string): string {
  return content.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

/** Parse an inline frontmatter list like `tags: [a, b, c]`. */
function readTags(frontmatter: string | null): string[] {
  if (!frontmatter) return [];
  const raw = readFrontmatterKey(frontmatter, "tags");
  if (!raw) return [];
  return raw
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function folderOf(path: string): string {
  const i = path.indexOf("/");
  return i === -1 ? "root" : path.slice(0, i);
}

function stemOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/\.md$/i, "");
}

/**
 * Human title for display — never a path, never slug dashes, and never an
 * em-dash (house rule: no long dashes anywhere in the interface).
 */
function titleOf(body: string, path: string): string {
  const m = body.match(/^#\s+(.+)$/m);
  const raw = m
    ? m[1].trim()
    : stemOf(path).replace(/[-_]+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());
  return raw.replace(/\s*[—–]\s*/g, " · ");
}

/** Build the link graph: nodes = files, edges = resolved [[links]]. */
export function buildGraph(files: BrainFile[]): BrainGraph {
  const nodes = new Map<string, GraphNode>();
  // [[target]] resolves against frontmatter ids first, then filename stems.
  const byId = new Map<string, string>();
  const byStem = new Map<string, string>();

  for (const f of files) {
    const { frontmatter, body } = splitFrontmatter(f.content);
    const id = frontmatter ? readFrontmatterKey(frontmatter, "id") : null;
    nodes.set(f.path, {
      path: f.path,
      title: titleOf(body, f.path),
      id,
      type: frontmatter ? readFrontmatterKey(frontmatter, "type") : null,
      tags: readTags(frontmatter),
      status: frontmatter ? readFrontmatterKey(frontmatter, "status") : null,
      updated: frontmatter ? readFrontmatterKey(frontmatter, "updated") : null,
      summary_l0: frontmatter ? readFrontmatterKey(frontmatter, "summary_l0") : null,
      folder: folderOf(f.path),
      size: f.content.length,
      inDegree: 0,
      outDegree: 0,
    });
    if (id) byId.set(id.toLowerCase(), f.path);
    byStem.set(stemOf(f.path).toLowerCase(), f.path);
  }

  const edges: GraphEdge[] = [];
  const brokenLinks: BrokenLink[] = [];
  const seen = new Set<string>();

  for (const f of files) {
    for (const m of stripCode(f.content).matchAll(WIKI_LINK)) {
      const raw = m[1].trim();
      if (!/[a-z0-9]/i.test(raw)) continue; // placeholder like [[...]], notation not a link
      const key = raw.toLowerCase();
      const target = byId.get(key) ?? byStem.get(key);
      if (!target) {
        brokenLinks.push({ source: f.path, target: raw });
        continue;
      }
      if (target === f.path) continue; // self-link, ignore
      const dedup = `${f.path}→${target}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      edges.push({ source: f.path, target });
      nodes.get(f.path)!.outDegree++;
      nodes.get(target)!.inDegree++;
    }
  }

  return { nodes: [...nodes.values()], edges, brokenLinks };
}

/* ---------- health ---------- */

/**
 * Staleness contract: max age in days of `updated` per folder, applied only
 * to files whose status is active/volatile (stable files don't rot).
 * now.md's 14-day rule comes from brain-protocol.md; the rest extends it.
 */
const TTL_DAYS: Record<string, number> = {
  "now.md": 14,
  "context/": 90,
  "people/": 180,
  "projects/": 180,
  "personal/": 180,
};

const STALENESS_STATUSES = new Set(["active", "volatile"]);

/** Files that legitimately have no inbound links. */
function orphanExempt(path: string): boolean {
  return (
    !path.includes("/") || // root files are entry points
    path.startsWith("inbox/") ||
    path.startsWith("decisions/") ||
    path.endsWith("_template.md") ||
    path.toLowerCase().endsWith("readme.md")
  );
}

function ttlFor(path: string): number | null {
  if (TTL_DAYS[path] !== undefined) return TTL_DAYS[path];
  for (const [prefix, days] of Object.entries(TTL_DAYS)) {
    if (prefix.endsWith("/") && path.startsWith(prefix)) return days;
  }
  return null;
}

export interface StaleFile {
  path: string;
  updated: string;
  ageDays: number;
  ttlDays: number;
}

export interface HealthReport {
  generatedOn: string;
  files: number;
  score: number;
  brokenLinks: BrokenLink[];
  orphans: string[];
  stale: StaleFile[];
  missingSummaries: string[];
  inbox: string[];
}

/** `todayISO` as YYYY-MM-DD (owner timezone) — passed in so this stays pure. */
export function buildHealth(graph: BrainGraph, todayISO: string): HealthReport {
  const today = new Date(`${todayISO}T00:00:00Z`).getTime();

  const orphans = graph.nodes
    .filter((n) => n.inDegree === 0 && !orphanExempt(n.path))
    .map((n) => n.path);

  const stale: StaleFile[] = [];
  for (const n of graph.nodes) {
    const ttl = ttlFor(n.path);
    if (ttl === null) continue;
    if (n.status && !STALENESS_STATUSES.has(n.status.toLowerCase())) continue;
    if (!n.updated || !/^\d{4}-\d{2}-\d{2}/.test(n.updated)) continue;
    const age = Math.floor(
      (today - new Date(`${n.updated.slice(0, 10)}T00:00:00Z`).getTime()) / 86_400_000,
    );
    if (age > ttl) stale.push({ path: n.path, updated: n.updated.slice(0, 10), ageDays: age, ttlDays: ttl });
  }
  stale.sort((a, b) => b.ageDays - a.ageDays);

  const missingSummaries = graph.nodes
    .filter(
      (n) =>
        !n.summary_l0 &&
        !n.path.startsWith("inbox/") &&
        !n.path.endsWith("_template.md"),
    )
    .map((n) => n.path);

  const inbox = graph.nodes.filter((n) => n.path.startsWith("inbox/")).map((n) => n.path);

  // Orphans are reported but cost nothing: a standalone side project with
  // no inbound links is information, not sickness.
  const score = Math.max(
    0,
    100 -
      5 * graph.brokenLinks.length -
      2 * stale.length -
      1 * missingSummaries.length,
  );

  return {
    generatedOn: todayISO,
    files: graph.nodes.length,
    score,
    brokenLinks: graph.brokenLinks,
    orphans,
    stale,
    missingSummaries,
    inbox,
  };
}

/** Render a health report as a compact human-readable block (MCP tool output). */
export function renderHealth(r: HealthReport): string {
  const lines: string[] = [
    `Brain health — ${r.generatedOn} — ${r.files} files — score ${r.score}/100`,
    "",
  ];
  lines.push(`Broken [[links]] (${r.brokenLinks.length}) — seams to fill or typos:`);
  for (const b of r.brokenLinks) lines.push(`  - ${b.source} → [[${b.target}]]`);
  if (!r.brokenLinks.length) lines.push("  none");

  lines.push("", `Orphans (${r.orphans.length}) — no inbound links, unreachable by browsing links:`);
  for (const p of r.orphans) lines.push(`  - ${p}`);
  if (!r.orphans.length) lines.push("  none");

  lines.push("", `Stale (${r.stale.length}) — active/volatile files past their TTL:`);
  for (const s of r.stale) lines.push(`  - ${s.path} (updated ${s.updated}, ${s.ageDays}d old, TTL ${s.ttlDays}d)`);
  if (!r.stale.length) lines.push("  none");

  lines.push("", `Missing summary_l0 (${r.missingSummaries.length}):`);
  for (const p of r.missingSummaries) lines.push(`  - ${p}`);
  if (!r.missingSummaries.length) lines.push("  none");

  lines.push("", `Inbox awaiting ingestion (${r.inbox.length}):`);
  for (const p of r.inbox) lines.push(`  - ${p}`);
  if (!r.inbox.length) lines.push("  empty");

  return lines.join("\n");
}
