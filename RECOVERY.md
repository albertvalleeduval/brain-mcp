# RECOVERY — rebuild from zero

> Scenarios covered: Cloudflare account lost/banned/down, machine lost, or a
> plain clean redeploy. Estimated time: ~15 minutes.
> Principle: Cloudflare owns nothing, it only executes. The code lives on
> GitHub (this repo), the brain data lives on GitHub (your brain repo) and in
> every local clone. The worst case degrades to a folder of readable
> markdown — never to nothing.

## What dies with the Cloudflare account (and how to regenerate it)

| Lost | Severity | Regeneration |
|---|---|---|
| Wrangler secrets (3) | none | see step 4 |
| KV `OAUTH_KV` (sessions/grants) | none | log back in, that's it |
| Durable Object `BrainMCP` | none | disposable state, recreated on first call |
| The workers.dev URL | low | new account URL + update the Claude connector |

## Procedure

1. **Clone the repo** (or use a local clone):
   `git clone <this-repo> && cd <folder> && npm install && npm --prefix app install`

2. **New Cloudflare account** (free tier is enough): `npx wrangler login`.

3. **Recreate the KV**: `npx wrangler kv namespace create OAUTH_KV`
   then put the returned `id` into `wrangler.jsonc` → `kv_namespaces`.

4. **Recreate the 3 secrets** (`npx wrangler secret put <NAME>`):
   - `GITHUB_BRAIN_TOKEN`: new fine-grained GitHub PAT, scoped to the brain
     repo only, permissions Contents read/write + Metadata read.
   - `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`: GitHub OAuth App
     (Settings → Developer settings → OAuth Apps). Callback URL:
     `https://<new-worker>.workers.dev/callback`. Reuse the existing app by
     changing the callback, or create a fresh one.

5. **Deploy**: `npm --prefix app run build && npx wrangler deploy`.

6. **Reconnect the clients**:
   - claude.ai → Settings → Connectors: replace the connector URL with
     `https://<new-worker>.workers.dev/mcp`, re-authorize.
   - Browser: `https://<new-worker>.workers.dev/app/login`.
   - Reinstall the PWA on your phone (share target).

## Post-recovery checks

- `curl -i https://<worker>/mcp -X POST` → 401 with a `WWW-Authenticate` header.
- `/app/login` → GitHub redirect → the app renders with the graph.
- In a Claude chat: `list_brain` answers.

## Data backups (independent of Cloudflare)

- The brain is in git: every local clone is a full copy with history. Keep one
  fresh: `git -C <your-brain-clone> pull`.
- If GitHub itself is the problem: `git clone --mirror` to another remote
  (GitLab, external disk). Same for this repo.

## Structural dependencies to know about

The server uses Cloudflare APIs (Durable Objects via `agents/mcp`, KV, static
assets). Migrating to another host means rewriting that shell; the logic
(`src/graph.ts`, `src/ops.ts`, `src/guards.ts`, `src/brain.ts`) and the UI
(`app/`, a standard Vite SPA) are portable as-is.
