# brain-mcp

**Your second brain as a private git repo, wired into claude.ai.**

A remote [MCP](https://modelcontextprotocol.io) server + web cockpit for a
personal "second brain" made of plain markdown files in a **private GitHub
repo**. Every new Claude chat can read your context (who you are, what you're
working on, what you decided) and write back to it — through guarded,
intent-shaped tools. A single-page web app renders the same brain as a live
knowledge graph.

Runs entirely on the **Cloudflare Workers free plan**. No database, no vector
store, no server to babysit: GitHub is the storage, git history is the backup,
markdown is the format you'll still be able to read in 30 years.

## What you get

- **MCP connector for claude.ai** — Streamable HTTP at `/mcp`, OAuth 2.1 + PKCE
  handshake handled by `@cloudflare/workers-oauth-provider`, GitHub login
  restricted to a single allowed account (yours).
- **Read tools** (tiered, token-efficient): `list_brain` (file map + one-line
  summaries), `get_brain_file`, `search_brain`, `get_graph`, `brain_health`.
- **Write tools** (intent-shaped — no raw "write anywhere"):
  - `add_to_inbox(filename, content)` — stage into `inbox/`, never overwrites.
  - `append_decision(text)` — append a dated entry to `decisions/YYYY-MM.md` (append-only).
  - `update_now(content)` — replace `now.md`, bump the `updated:` date.
  - `upsert_project(name, content)` — create/update `projects/<slug>.md`.
  - `upsert_file(path, content)` — general fallback, restricted to known folders.
  - `delete_inbox_item(filename)` — the only delete, restricted to `inbox/`.
- **Guards on every write**: refuses content that looks like an API key, token
  or private key; refuses paths outside the brain's folders; `decisions/` is
  append-only; deletes are restricted to `inbox/`.
- **Web cockpit** at the Worker root (GitHub-gated session): force-directed
  knowledge graph (canvas + d3-force), file reader with wiki-links and
  backlinks, inline editor, inbox triage, health report (broken links, stale
  files, orphans), decision log, and a temporal replay of the brain's growth
  from git history. The UI language is currently French.
- **Two themes, one anatomy** — a dark "observatory" mode (pure black, uniform
  grey nodes, white re-ink, faint coordinate grid) and a light "Swiss grid"
  mode (white paper, nodes colored by file type and sized by degree, Swiss
  red). A segmented switch (light | auto | dark) lives on the graph page and
  in the sidebar footer; **auto follows the actual sunset/sunrise** for your
  location (NOAA formula, no API). All deltas live in CSS tokens and
  `GRAPH_SKINS` — see `design/guidelines.md`. Set your coordinates in
  `app/src/theme.ts` and in the inline script of `app/index.html`
  (default: Paris).
- **PWA share target** — share a link/text from your phone straight into `inbox/`.

## Architecture

```
claude.ai ──(OAuth 2.1 + PKCE)──► Worker (its own OAuth server)
                                    │  GitHub login = identity gate (ALLOWED_LOGIN)
                                    ▼
                              /mcp  Durable Object (MCP tools)
Browser ──(cookie session)──► /api + static SPA (Vite + React)
                                    │
                                    ▼
                     GitHub contents API — your private brain repo
                     (fine-grained PAT, server-side only)
```

Two credentials, two jobs, never mixed:

- The **GitHub OAuth App** only proves *who you are*. Its token is never used
  to touch the repo.
- A **fine-grained PAT** (`GITHUB_BRAIN_TOKEN`, scoped to the brain repo only,
  Contents read/write) does all repo access, server-side. claude.ai never sees it.

## The brain repo

Create a **separate, private** repo (e.g. `my-brain`) holding plain markdown.
The layout the tools expect:

```
README.md            # how your brain works (also read by Claude)
identity.md          # who you are — stable base context
preferences.md       # how you like to work
now.md               # current focus + deadlines (updated often)
context/             # long-lived context (company, school, protocols…)
people/              # one file per person
projects/            # one file per project
domains/             # knowledge areas
decisions/YYYY-MM.md # append-only decision log
personal/            # whatever is yours
inbox/               # raw captures, triaged later
```

Files carry a small YAML frontmatter the graph and health report understand
(all fields optional):

```markdown
---
id: my-project
type: project
tags: [dev]
status: active
summary_l0: "One-line summary shown in list_brain."
updated: 2026-07-07
---

# My project
Links to other files as [[people/jane-doe]] wiki-links → graph edges.
```

## Setup

Prereqs: Node 18+, a Cloudflare account (free), a GitHub account.

### 1. Install

```bash
npm install
npm --prefix app install
```

### 2. Configure your identity

Edit the `vars` block in `wrangler.jsonc`:

| Var | What it is |
|---|---|
| `BRAIN_OWNER` | GitHub login that owns the brain repo |
| `BRAIN_REPO` | Brain repo name (e.g. `my-brain`) |
| `BRAIN_BRANCH` | Branch to read/write (`main`) |
| `ALLOWED_LOGIN` | The **only** GitHub login allowed to authenticate |
| `TIMEZONE` | IANA timezone for date stamps (e.g. `Europe/Paris`) |
| `CENTER_PATH` | Optional: the graph's central "me" node (e.g. `people/me.md`) |

### 3. Create a GitHub OAuth App (login / identity)

GitHub → Settings → Developer settings → **OAuth Apps** → **New OAuth App**.

- **Homepage URL:** your future worker URL, e.g. `https://brain-mcp.<your-subdomain>.workers.dev`
- **Authorization callback URL:** the **Worker's own callback** —
  `https://brain-mcp.<your-subdomain>.workers.dev/callback`

> Architecture note: the Worker is its *own* OAuth 2.1 server for claude.ai;
> GitHub is only the upstream login. So GitHub redirects back to the
> **Worker's** `/callback`, and that is the only callback GitHub needs.
> claude.ai registers its own redirect URIs with the Worker automatically via
> dynamic client registration (`/register`). You won't know the exact
> workers.dev subdomain until the first deploy — deploy once with a
> placeholder, then come back and set the real URL.

Copy the **Client ID** and generate a **Client secret**.

### 4. Create the fine-grained PAT (repo read/write)

GitHub → Settings → Developer settings → **Fine-grained tokens** → **Generate new token**.

- **Repository access:** *Only select repositories* → your brain repo
- **Permissions:** `Contents` = **Read and write** (`Metadata` = Read is added automatically)

### 5. Cloudflare: KV + secrets

```bash
npx wrangler login
npx wrangler kv namespace create OAUTH_KV
# paste the printed id into wrangler.jsonc (REPLACE_WITH_KV_ID)

npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GITHUB_BRAIN_TOKEN
```

### 6. Build the app & deploy

```bash
npm --prefix app run build
npx wrangler deploy
```

Your MCP endpoint is the printed URL **+ `/mcp`**. If your OAuth App used a
placeholder host, update its Homepage/callback URLs to the real one now.

> The template ships without branding: add your own `favicon.svg`,
> `icon-192.png` and `icon-512.png` to `app/public/`, then restore the
> `<link rel="icon">` tags in `app/index.html` and the `icons` array in
> `app/public/manifest.webmanifest` (icons are required for the PWA
> install / share-target experience on mobile).

### 7. Connect

- **claude.ai** → Settings → **Connectors** → **Add custom connector** → paste
  the `/mcp` URL → Connect → log in with GitHub. Anyone who isn't
  `ALLOWED_LOGIN` gets a 403.
- **Browser cockpit** → open the worker URL → "Se connecter avec GitHub".

### 8. Smoke test

1. In a new chat: *"list my brain"* → file map with summaries.
2. *"read my now.md"* → file content.
3. *"add a test decision: validated the MCP write path"* → appends to
   `decisions/YYYY-MM.md`; confirm the commit on GitHub.

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in the three secrets
npx wrangler dev
```

UI-only work doesn't need any of that: `npm --prefix app run dev` then open
`/mock.html` — the API is stubbed with plausible fake data (`app/src/dev-mock.ts`).

## Security model

See [SECURITY.md](SECURITY.md) for the full threat model. Short version: the
worker URL is public but serves nothing without a valid GitHub-verified
session; a single `ALLOWED_LOGIN` gate covers both surfaces (MCP + browser);
the repo PAT lives only in Worker secrets; every write goes through secret
detection and folder guards; rendered markdown is sanitized against stored XSS.
Disaster recovery (lost Cloudflare account, etc.) is covered in
[RECOVERY.md](RECOVERY.md) — worst case degrades to a folder of readable
markdown, never to nothing.

## License

[MIT](LICENSE).
