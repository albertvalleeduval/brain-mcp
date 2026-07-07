/**
 * Runtime configuration, read from wrangler.jsonc `vars`.
 *
 * Non-secret, per-deployment identity settings live there (owner, repo,
 * allowed login, timezone…) so a fork only edits wrangler.jsonc — never code.
 * Secrets (tokens, OAuth client) stay in `wrangler secret` / .dev.vars.
 *
 * `initConfig(env)` must run once per isolate before any cfg() read; it is
 * called from the Worker fetch handler and from the Durable Object init.
 */

export interface BrainConfig {
  /** GitHub login that owns the brain repo. */
  owner: string;
  /** Brain repo name (the private markdown repo). */
  repo: string;
  /** Branch to read/write. */
  branch: string;
  /** The only GitHub identity allowed to use this server (MCP and browser). */
  allowedLogin: string;
  /** IANA timezone used to stamp dates (decisions, captures). */
  timezone: string;
  /** Optional path of the graph's central "me" node, e.g. "people/me.md". */
  centerPath: string;
}

let current: BrainConfig | null = null;

export function initConfig(env: Env): void {
  const req = (name: string, v: string | undefined): string => {
    if (!v) throw new Error(`Missing required var "${name}" in wrangler.jsonc.`);
    return v;
  };
  current = {
    owner: req("BRAIN_OWNER", env.BRAIN_OWNER),
    repo: req("BRAIN_REPO", env.BRAIN_REPO),
    branch: env.BRAIN_BRANCH || "main",
    allowedLogin: req("ALLOWED_LOGIN", env.ALLOWED_LOGIN),
    timezone: env.TIMEZONE || "UTC",
    centerPath: env.CENTER_PATH || "",
  };
}

export function cfg(): BrainConfig {
  if (!current) throw new Error("Config not initialized — initConfig(env) must run first.");
  return current;
}
