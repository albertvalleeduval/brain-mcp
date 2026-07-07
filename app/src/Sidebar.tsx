/** Cockpit sidebar v3 — a nav rail, not a dashboard.
 *  Fixed context stays live (search + Maintenant); everything else is a tile
 *  carrying ONE figure (a badge) that routes to its own page for the detail. */

import type { BrainGraph, HealthReport, Commit } from "./types";
import type { NavName } from "./router";
import { parseFocus, parseDeadlines } from "./nowparse";

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = ms / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))} min`;
  if (h < 24) return `${Math.round(h)} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "hier" : `${d} j`;
}

const DONE = new Set(["done", "closed", "clos", "archived", "archivé", "abandonné", "terminé"]);

/** Panel-left glyph: a framed rail. Reused for collapse + reopen.
 *  Angles vifs, trait 1.5 — pas de coins arrondis. */
export function PanelIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </svg>
  );
}

/** Custom nav glyphs — 24px grid, 1.5px hairline stroke, HUD vocabulary:
 *  no rounded-corner friendliness, each one reads at 15px. */
const ICON_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "square" as const,
  strokeLinejoin: "miter" as const,
  "aria-hidden": true as const,
};

const NAV_ICONS: Record<NavName, JSX.Element> = {
  // the sphere: a pinned core and its satellites
  home: (
    <svg {...ICON_PROPS}>
      <line x1="12" y1="12" x2="5.6" y2="7.4" />
      <line x1="12" y1="12" x2="18.2" y2="6.8" />
      <line x1="12" y1="12" x2="17" y2="17.6" />
      <line x1="12" y1="12" x2="6.8" y2="17" />
      <circle cx="12" cy="12" r="2.3" />
      <circle cx="5" cy="7" r="1.3" />
      <circle cx="19" cy="6.2" r="1.3" />
      <circle cx="17.8" cy="18.3" r="1.3" />
      <circle cx="6" cy="17.8" r="1.3" />
    </svg>
  ),
  // a flat folder
  projets: (
    <svg {...ICON_PROPS}>
      <path d="M3 6.5h6.2l1.8 2h10v11H3v-13z" />
      <line x1="3" y1="11" x2="21" y2="11" />
    </svg>
  ),
  // a calendar with one marked day
  echeances: (
    <svg {...ICON_PROPS}>
      <rect x="3.5" y="5.5" width="17" height="15" />
      <line x1="3.5" y1="10" x2="20.5" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
      <rect x="13.6" y="13" width="3.2" height="3.2" fill="currentColor" stroke="none" />
    </svg>
  ),
  // the staging tray
  inbox: (
    <svg {...ICON_PROPS}>
      <path d="M4 13.5l2.6-7h10.8l2.6 7v6H4v-6z" />
      <path d="M4 13.5h4.8l1.5 2.6h3.4l1.5-2.6H20" />
    </svg>
  ),
  // a flowchart decision node
  decisions: (
    <svg {...ICON_PROPS}>
      <path d="M12 3.8l8.2 8.2-8.2 8.2-8.2-8.2z" />
    </svg>
  ),
  // the commit log
  journal: (
    <svg {...ICON_PROPS}>
      <circle cx="5.2" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="5.2" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="5.2" cy="17.5" r="1.1" fill="currentColor" stroke="none" />
      <line x1="9.5" y1="6.5" x2="20.5" y2="6.5" />
      <line x1="9.5" y1="12" x2="20.5" y2="12" />
      <line x1="9.5" y1="17.5" x2="20.5" y2="17.5" />
    </svg>
  ),
  // the vitals monitor
  health: (
    <svg {...ICON_PROPS}>
      <path d="M2.8 12.6h3.7l2-5.4 3.7 9.6 2-4.2h7" />
    </svg>
  ),
};

function Tile({
  name,
  label,
  badge,
  active,
  urgent,
  onNav,
}: {
  name: NavName;
  label: string;
  badge: string;
  active: boolean;
  urgent?: boolean;
  onNav: (r: NavName) => void;
}) {
  return (
    <button className={`tile${active ? " on" : ""}`} onClick={() => onNav(name)}>
      <span className="tile-label">
        <span className="tile-ico">{NAV_ICONS[name]}</span>
        {label}
      </span>
      <span className={`tile-badge${urgent ? " urgent" : ""}`}>{badge}</span>
    </button>
  );
}

export function Sidebar({
  graph,
  health,
  history,
  nowBody,
  search,
  route,
  onSearch,
  onNav,
  onCollapse,
}: {
  graph: BrainGraph;
  health: HealthReport;
  history: Commit[];
  nowBody: string;
  search: string;
  route: NavName | "file";
  onSearch: (q: string) => void;
  onNav: (r: NavName) => void;
  onCollapse: () => void;
}) {
  const focus = parseFocus(nowBody);
  const deadlines = parseDeadlines(nowBody, health.generatedOn);

  const nextDeadline = deadlines
    .filter((d) => d.daysLeft !== null)
    .sort((a, b) => (a.daysLeft as number) - (b.daysLeft as number))[0];

  const projects = graph.nodes.filter((n) => n.folder === "projects");
  const activeProjects = projects.filter((n) => !DONE.has((n.status ?? "").toLowerCase())).length;

  const lastDecision = graph.nodes
    .filter((n) => n.folder === "decisions")
    .map((n) => n.updated)
    .filter((u): u is string => !!u)
    .sort()
    .at(-1);

  return (
    <aside className="side">
      <div className="brand">
        <div className="brand-row">
          <h1><button className="brand-btn" onClick={() => onNav("home")}>my²brain</button></h1>
          <button className="side-toggle" onClick={onCollapse} aria-label="Réduire la sidebar" title="Réduire la sidebar">
            <PanelIcon />
          </button>
        </div>
        <div className="meta">
          main · {health.files} fichiers · {graph.edges.length} liens · santé <b>{health.score}/100</b>
        </div>
      </div>

      <div className="search">
        <input
          type="search"
          placeholder="rechercher dans le brain…"
          aria-label="Rechercher"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>

      <section className="sec">
        <div className="eyebrow"><span>Maintenant</span></div>
        {focus.length > 0 ? (
          <>
            <div className="focus-lead">{focus[0]}</div>
            <div className="focus-rest">
              {focus.slice(1, 4).map((f, i) => (
                <div className="row" key={i}><span className="tick">·</span><span>{f}</span></div>
              ))}
            </div>
          </>
        ) : (
          <div className="health"><div className="ok">now.md sans section « Focus courant »</div></div>
        )}
      </section>

      <nav className="nav">
        <Tile name="home" label="Graph" badge={`${graph.nodes.length} nœuds`} active={route === "home"} onNav={onNav} />
        <Tile name="projets" label="Projets" badge={`${activeProjects} actif${activeProjects > 1 ? "s" : ""}`} active={route === "projets"} onNav={onNav} />
        <Tile
          name="echeances"
          label="Échéances"
          badge={nextDeadline ? `J-${nextDeadline.daysLeft}` : "—"}
          urgent={nextDeadline?.daysLeft != null && nextDeadline.daysLeft <= 7}
          active={route === "echeances"}
          onNav={onNav}
        />
        <Tile
          name="inbox"
          label="Inbox"
          badge={health.inbox.length ? `${health.inbox.length} en attente` : "vide"}
          urgent={health.inbox.length > 0}
          active={route === "inbox"}
          onNav={onNav}
        />
        <Tile name="decisions" label="Décisions" badge={lastDecision ?? "—"} active={route === "decisions"} onNav={onNav} />
        <Tile name="journal" label="Journal" badge={history[0] ? relTime(history[0].date) : "—"} active={route === "journal"} onNav={onNav} />
        <Tile
          name="health"
          label="Santé"
          badge={`${health.score}/100`}
          urgent={health.score < 70}
          active={route === "health"}
          onNav={onNav}
        />
      </nav>

      <div className="side-foot">
        <span>direction 1B · grille suisse</span>
        <a href="/app/logout">déconnexion</a>
      </div>
    </aside>
  );
}
