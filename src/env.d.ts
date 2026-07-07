/**
 * Env bindings beyond what `wrangler types` generated.
 *
 * Secrets are set via `wrangler secret put` (never in wrangler.jsonc), and
 * plain vars live in wrangler.jsonc `vars` — declared here so TypeScript
 * knows about both without regenerating worker-configuration.d.ts.
 */
interface Env {
  /** GitHub OAuth App client id (login handshake). */
  GITHUB_CLIENT_ID: string;
  /** GitHub OAuth App client secret (login handshake). */
  GITHUB_CLIENT_SECRET: string;
  /** Fine-grained PAT scoped to the brain repo: Contents r/w + Metadata read. */
  GITHUB_BRAIN_TOKEN: string;

  /** GitHub login that owns the brain repo (wrangler.jsonc vars). */
  BRAIN_OWNER: string;
  /** Brain repo name. */
  BRAIN_REPO: string;
  /** Branch to read/write (default "main"). */
  BRAIN_BRANCH?: string;
  /** The only GitHub login allowed to authenticate. */
  ALLOWED_LOGIN: string;
  /** IANA timezone for date stamping (default "UTC"). */
  TIMEZONE?: string;
  /** Optional graph center node path, e.g. "people/me.md". */
  CENTER_PATH?: string;
}
