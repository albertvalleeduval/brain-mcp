/**
 * brain-mcp — remote MCP server for a private markdown "second brain" repo.
 *
 * claude.ai  --(OAuth 2.1 + PKCE)-->  OAuthProvider  --(GitHub login)-->  gate to ALLOWED_LOGIN
 *                                          |
 *                                          v
 *                             /mcp  (Streamable HTTP)  -->  BrainMCP (Durable Object)
 *                                          |
 *                                          v
 *                           GitHub contents API via GITHUB_BRAIN_TOKEN
 */

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GitHubHandler } from "./github-handler";
import { registerTools } from "./tools";
import { initConfig } from "./config";
import type { Props } from "./types";

const SERVER_INSTRUCTIONS = `This is the owner's private "second brain".

Read strategy (tiered loading — stay token-efficient):
1. Call list_brain FIRST to get the file map with one-line (summary_l0) and short (summary_l1) summaries.
2. Only call get_brain_file for files that are actually relevant to the task.
3. Use search_brain for keyword lookups across the whole brain.

At the start of a new chat, load list_brain plus the stable base — README.md, identity.md, preferences.md — and now.md to establish global context.

Before writing anything, read brain-protocol.md to follow the brain's rules. Prefer the intent-shaped write tools:
- add_to_inbox for anything ambiguous (safe staging, classified later),
- append_decision for decisions (append-only monthly log),
- update_now to refresh current focus,
- upsert_project for project notes,
- upsert_file only as a general fallback.
Never write secrets, API keys, or credentials into the brain.`;

export class BrainMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer(
    { name: "brain-mcp", version: "1.0.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  async init(): Promise<void> {
    // The Durable Object may live in its own isolate — init config here too.
    initConfig(this.env);
    registerTools(this.server, () => this.env.GITHUB_BRAIN_TOKEN);
  }
}

/** Origins allowed to reach the MCP endpoint from a browser context. */
const ALLOWED_ORIGINS = new Set([
  "https://claude.ai",
  "https://claude.com",
]);

const provider = new OAuthProvider({
  apiHandlers: {
    "/mcp": BrainMCP.serve("/mcp") as any,
  },
  defaultHandler: GitHubHandler as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    initConfig(env);
    // Validate Origin when present (browser-originated). Server-to-server MCP
    // calls from claude.ai carry no Origin and are allowed through. The
    // Worker's own origin is allowed for the /app UI and /api routes.
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin && !ALLOWED_ORIGINS.has(origin)) {
      return new Response("Forbidden origin.", { status: 403 });
    }
    return provider.fetch(request, env, ctx);
  },
};
