/** Dev-only visual harness: stubs the Worker API with plausible data so the
 *  app can be eyeballed without wrangler/OAuth. Open /mock.html under
 *  `npm run dev` (optionally ?route=/projets to boot on a page). Not part of
 *  the production build — vite only bundles index.html. */

const today = new Date().toISOString().slice(0, 10);
const d = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

type N = { path: string; title: string; folder: string; updated: string; deg?: number };
const defs: N[] = [
  { path: "people/camille-martin.md", title: "Camille Martin", folder: "people", updated: d(1) },
  { path: "README.md", title: "README", folder: "root", updated: d(3) },
  { path: "identity.md", title: "Identité", folder: "root", updated: d(20) },
  { path: "preferences.md", title: "Préférences", folder: "root", updated: d(45) },
  { path: "now.md", title: "Now", folder: "root", updated: d(0) },
  { path: "context/universite.md", title: "Université", folder: "context", updated: d(12) },
  { path: "context/atelier-studio.md", title: "Atelier Studio", folder: "context", updated: d(2) },
  { path: "context/brain-protocol.md", title: "Brain protocol", folder: "context", updated: d(60) },
  { path: "people/marie-lefort.md", title: "Marie Lefort", folder: "people", updated: d(15) },
  { path: "people/thomas-garnier.md", title: "Thomas Garnier", folder: "people", updated: d(90) },
  { path: "people/lucas-morel.md", title: "Lucas Morel", folder: "people", updated: d(200) },
  { path: "people/emma-dubois.md", title: "Emma Dubois", folder: "people", updated: d(40) },
  { path: "projects/brain-mcp.md", title: "Brain MCP", folder: "projects", updated: d(1) },
  { path: "projects/site-atelier.md", title: "Site Atelier", folder: "projects", updated: d(5) },
  { path: "projects/memoire.md", title: "Mémoire", folder: "projects", updated: d(8) },
  { path: "projects/client-horizon.md", title: "Client Horizon", folder: "projects", updated: d(3) },
  { path: "projects/podcast.md", title: "Podcast", folder: "projects", updated: d(150) },
  { path: "domains/design-systems.md", title: "Design systems", folder: "domains", updated: d(30) },
  { path: "domains/cloudflare-workers.md", title: "Cloudflare Workers", folder: "domains", updated: d(25) },
  { path: "domains/growth.md", title: "Growth", folder: "domains", updated: d(70) },
  { path: "domains/ia-agents.md", title: "IA & agents", folder: "domains", updated: d(4) },
  { path: "decisions/2026-07.md", title: "Décisions 2026-07", folder: "decisions", updated: d(2) },
  { path: "decisions/2026-06.md", title: "Décisions 2026-06", folder: "decisions", updated: d(28) },
  { path: "personal/sport.md", title: "Sport", folder: "personal", updated: d(55) },
  { path: "personal/lectures.md", title: "Lectures", folder: "personal", updated: d(110) },
  { path: "inbox/idee-newsletter.md", title: "Idée newsletter", folder: "inbox", updated: d(6) },
  { path: "inbox/lien-article-mcp.md", title: "Lien article MCP", folder: "inbox", updated: d(9) },
];

// Pad the mock to the real brain's size (~78 files) so the sphere layout is
// judged under honest density. Deterministic pseudo-random wiring.
const FILLER_FOLDERS = ["people", "domains", "personal", "projects", "context"];
for (let i = 0; i < 51; i++) {
  const folder = FILLER_FOLDERS[i % FILLER_FOLDERS.length];
  defs.push({
    path: `${folder}/note-${String(i + 1).padStart(2, "0")}.md`,
    title: `${folder.slice(0, 1).toUpperCase()}${folder.slice(1)} note ${i + 1}`,
    folder,
    updated: d((i * 37) % 240),
  });
}

const E = (s: number, t: number) => ({ source: defs[s].path, target: defs[t].path });
const edges = [
  E(0, 5), E(0, 6), E(0, 12), E(0, 13), E(0, 14), E(0, 8), E(0, 23), E(0, 2),
  E(12, 18), E(12, 20), E(12, 7), E(13, 17), E(13, 6), E(14, 5), E(15, 8),
  E(15, 6), E(9, 6), E(10, 16), E(11, 15), E(21, 12), E(21, 13), E(22, 14),
  E(19, 13), E(20, 12), E(24, 0), E(3, 7), E(1, 7), E(4, 21),
];
// Wire the filler notes: most attach to a hub (me, a project, a domain), a
// third also link to a sibling — enough cross-volume edges to weave the ball.
for (let i = 27; i < defs.length; i++) {
  const hubs = [0, 12, 13, 14, 15, 18, 19, 20, 6];
  edges.push(E(i, hubs[(i * 7) % hubs.length]));
  const j = 27 + ((i * 11) % (defs.length - 27));
  if (i % 3 === 0 && j !== i) edges.push(E(i, j));
}

const degree = new Map<string, number>();
for (const e of edges) {
  degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
  degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
}

const graph = {
  nodes: defs.map((n) => ({
    path: n.path, title: n.title, id: null, type: null, tags: [], status: null,
    updated: n.updated, summary_l0: "Résumé factice.", folder: n.folder, size: 1200,
    inDegree: degree.get(n.path) ?? 0, outDegree: 0,
  })),
  edges,
  brokenLinks: [{ source: "projects/site-atelier.md", target: "people/inconnu" }],
  centerPath: "people/camille-martin.md",
};

const health = {
  generatedOn: today, files: defs.length, score: 87,
  brokenLinks: graph.brokenLinks,
  orphans: ["personal/lectures.md"],
  stale: [
    { path: "people/lucas-morel.md", updated: d(200), ageDays: 200, ttlDays: 120 },
    { path: "projects/podcast.md", updated: d(150), ageDays: 150, ttlDays: 90 },
  ],
  missingSummaries: ["inbox/lien-article-mcp.md"],
  inbox: ["idee-newsletter.md", "lien-article-mcp.md"],
};

const commits = Array.from({ length: 14 }, (_, i) => ({
  sha: `abc${1000 + i}`,
  message: ["feat: note client Horizon", "now: focus refresh", "decision: pricing studio", "inbox: capture article"][i % 4],
  date: new Date(Date.now() - i * 43_200_000).toISOString(),
}));

const nowBody = `## Focus courant

- Refonte **brain MCP** : design de l'app
- Mémoire : plan détaillé chapitre 2
- Studio : proposition [[client-horizon]]

## Deadlines proches

- **10 juillet** : rendre le plan du mémoire
- **15 juillet** : démo client Horizon
- **Septembre** : bascule full-time studio
`;

const routes: Record<string, unknown> = {
  "/api/graph": graph,
  "/api/health": health,
  "/api/history": commits,
  "/api/replay": { frames: [] },
};

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  if (path in routes) return new Response(JSON.stringify(routes[path]), { status: 200 });
  if (path === "/api/file") {
    return new Response(JSON.stringify({ path: "now.md", content: nowBody }), { status: 200 });
  }
  if (path === "/api/search") return new Response(JSON.stringify({ paths: [] }), { status: 200 });
  return realFetch(input as RequestInfo, init);
};

// ?route=/projets → boot the SPA on that route. ?collapsed=1 → mini sidebar.
const params = new URLSearchParams(location.search);
const route = params.get("route");
if (route) history.replaceState({}, "", route);
if (params.get("collapsed") === "1") localStorage.setItem("side-collapsed", "1");

import("./main");
