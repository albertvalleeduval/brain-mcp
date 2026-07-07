# SECURITY — threat model

> The brain contains sensitive personal information. Absolute rule: nobody but
> the owner (the GitHub login in `ALLOWED_LOGIN`) may ever access it.

## Who can reach what

The worker URL is public, but **serves no data without a valid GitHub-verified
session**. Verify anonymously: every data endpoint (`/api/*`, `/mcp`) must
return 401. The served JS bundle contains no brain data — data only flows
after auth.

## The barriers (defense in depth)

1. **Private GitHub repos.** The brain repo (data) is private. Even without
   the Worker, the data is not readable.
2. **MCP** (`/mcp`): protected by OAuth 2.1 + PKCE
   (`@cloudflare/workers-oauth-provider`). The handshake forces a GitHub
   login, and `/callback` rejects (403) any identity other than
   `ALLOWED_LOGIN` BEFORE issuing a token. Registering a client via
   `/register` bypasses nothing: you still have to log in as the owner.
3. **Web app** (`/api/*`): GitHub-gated session cookie. `/app/login` → GitHub
   → `/callback` verifies `login === ALLOWED_LOGIN` before creating the
   session. The cookie is an opaque UUID v4 (122 bits) stored in KV:
   unforgeable (a forged cookie matches no KV entry → 401). Cookie is
   `HttpOnly` + `Secure` + `SameSite=Lax`. The `/api/*` middleware re-checks
   identity on every request. WRITE routes (PUT /api/file, POST /api/now,
   /api/decision, /api/inbox/delete) go through that same middleware, then
   through the guards in `src/ops.ts` (allowed folders, secret refusal,
   decisions/ append-only, delete restricted to inbox/). An anonymous caller
   gets 401 before any write.
4. **The GitHub token that reads the repo** (`GITHUB_BRAIN_TOKEN`) lives only
   as a Wrangler secret — never client-side, never in the bundle.
5. **Stored XSS** (ingested content): the Reader escapes raw HTML, neutralizes
   `javascript:`/`data:` URLs at the markdown-token level, then passes the
   output through an allowlist sanitizer (inert DOM) before injection.
   Without this, a booby-trapped file arriving through the PWA/ingestion
   could exfiltrate the brain from the authenticated session.

## The single control point

Everything rests on one value: the `ALLOWED_LOGIN` var (wrangler.jsonc), used
by both flows (MCP and app) via `src/config.ts`. It is deployment
configuration, read once per isolate — never derived from request input, and
it must stay that way.

## Accepted out-of-scope risks

- **Compromise of the owner's GitHub account**: whoever controls that account
  has everything. Protecting it (2FA, hardware key) is the last line, outside
  this codebase.
- **Leak of a Wrangler secret**: rotate via `wrangler secret put` (see
  RECOVERY.md). The PAT is scoped to the brain repo only, limiting blast radius.
- **CSRF on `/api`**: mitigated by `SameSite=Lax`, the Origin check in
  `index.ts`, and JSON-only mutation bodies.

## Checks to re-run after any auth change

```
curl -i https://<your-worker>/api/graph        # expect 401
curl -i -X POST https://<your-worker>/mcp      # expect 401
# and confirm the JS bundle contains none of your brain's content:
curl -s https://<your-worker>/assets/index-*.js | grep -ic <a-word-from-your-brain>   # expect 0
```

## Reporting

If you find a vulnerability in this template, please open a GitHub security
advisory (or a private report) rather than a public issue.
