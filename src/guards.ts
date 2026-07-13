/**
 * Write guardrails: keep the safe path the only path.
 * - Confine writes to the brain's known folders.
 * - Never let a secret/API key/token land in the brain.
 */

/** Root-level files that are allowed to be written directly. */
const ALLOWED_ROOT_FILES = new Set([
  "identity.md",
  "preferences.md",
  "now.md",
  "brain-protocol.md",
  "ingestion-protocol.md",
  "README.md",
  "CLAUDE.md",
]);

/** Top-level folders writes may target. */
const ALLOWED_DIRS = [
  "projects/",
  "decisions/",
  "context/",
  "personal/",
  "people/",
  "domains/",
  "inbox/",
  // Coherence layer: retained sources for provenance + the contradictions
  // ledger. Both editable via upsert (a tension's status flips
  // open → resolved/false-alarm/superseded; a source is never rewritten away).
  "sources/",
  "tensions/",
];

export function normalizePath(path: string): string {
  return path.trim().replace(/^\.?\//, "");
}

/** Reject path traversal, absolute paths, and anything outside the brain. */
export function checkPath(rawPath: string, opts: { requireMarkdown?: boolean } = {}): {
  ok: boolean;
  reason?: string;
} {
  const path = normalizePath(rawPath);
  if (!path) return { ok: false, reason: "Empty path." };
  if (path.includes("..") || path.includes("\\")) {
    return { ok: false, reason: "Path traversal is not allowed." };
  }
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) {
    return { ok: false, reason: "Absolute paths are not allowed." };
  }
  if (opts.requireMarkdown && !path.toLowerCase().endsWith(".md")) {
    return { ok: false, reason: "Only .md files are allowed here." };
  }

  const inAllowedDir = ALLOWED_DIRS.some((d) => path.startsWith(d));
  const isAllowedRoot = ALLOWED_ROOT_FILES.has(path);
  if (!inAllowedDir && !isAllowedRoot) {
    return {
      ok: false,
      reason: `"${path}" is outside the brain's known folders (${ALLOWED_DIRS.join(", ")}) or root files.`,
    };
  }
  return { ok: true };
}

/** A single filename with no slashes, safe for inbox/. */
export function checkFilename(name: string): { ok: boolean; reason?: string } {
  const n = name.trim();
  if (!n) return { ok: false, reason: "Empty filename." };
  if (n.includes("/") || n.includes("\\") || n.includes("..")) {
    return { ok: false, reason: "Filename must not contain path separators." };
  }
  if (!/^[\w.\- ]+$/.test(n)) {
    return { ok: false, reason: "Filename has unsupported characters." };
  }
  return { ok: true };
}

/**
 * Heuristic secret detection. Errs toward blocking: the brain must never
 * store credentials. Returns the label of the first match, or null.
 */
export function detectSecret(content: string): string | null {
  const patterns: [RegExp, string][] = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "PEM private key"],
    [/\bsk-[A-Za-z0-9]{20,}\b/, "OpenAI-style secret key (sk-...)"],
    [/\bsk-ant-[A-Za-z0-9_-]{20,}\b/, "Anthropic API key (sk-ant-...)"],
    [/\bghp_[A-Za-z0-9]{36,}\b/, "GitHub personal access token (ghp_...)"],
    [/\bgithub_pat_[A-Za-z0-9_]{50,}\b/, "GitHub fine-grained PAT (github_pat_...)"],
    [/\bgho_[A-Za-z0-9]{36,}\b/, "GitHub OAuth token (gho_...)"],
    [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, "Slack token (xox...)"],
    [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id (AKIA...)"],
    [/\bAIza[0-9A-Za-z_-]{35}\b/, "Google API key (AIza...)"],
    [/\bya29\.[0-9A-Za-z_-]{20,}\b/, "Google OAuth token (ya29...)"],
    [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, "JWT"],
    [
      // Assignment of a secret-looking VALUE. Excludes URLs and ordinary prose:
      // the value must be a 16+ char token (no spaces, not an http(s):// link).
      /\b(api[_-]?key|secret|password|passwd|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']?(?!https?:\/\/)[A-Za-z0-9+/_.\-]{16,}["']?/i,
      "key/secret assignment",
    ],
  ];
  for (const [re, label] of patterns) {
    if (re.test(content)) return label;
  }
  return null;
}
