/** Projets (/projets): every note under projects/, active first, newest first.
 *  Data comes straight from the graph nodes, no extra fetch. */

import type { BrainGraph, GraphNode } from "./types";

const DONE = new Set(["done", "closed", "clos", "archived", "archivé", "abandonné", "terminé"]);

function isActive(n: GraphNode): boolean {
  return !DONE.has((n.status ?? "").toLowerCase());
}

function ageDays(updated: string | null, today: string): number | null {
  if (!updated) return null;
  const d = (new Date(`${today}T00:00:00Z`).getTime() - new Date(updated).getTime()) / 86400000;
  return Number.isFinite(d) ? Math.max(0, Math.round(d)) : null;
}

export function ProjetsPage({
  graph,
  today,
  onOpen,
}: {
  graph: BrainGraph;
  today: string;
  onOpen: (path: string) => void;
}) {
  const projects = graph.nodes
    .filter((n) => n.folder === "projects")
    .sort((a, b) => {
      const act = Number(isActive(b)) - Number(isActive(a));
      if (act) return act;
      return (b.updated ?? "").localeCompare(a.updated ?? "");
    });

  const active = projects.filter(isActive).length;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Projets</h1>
        <span className="score">{active}<span className="score-max"> actif{active > 1 ? "s" : ""}</span></span>
      </div>
      <p className="page-sub">
        {projects.length} note{projects.length > 1 ? "s" : ""} sous <code>projects/</code>. Actifs en tête, puis par dernière modif.
      </p>

      {projects.length === 0 && <div className="ok-big">Aucun projet. Crée-en un avec <code>upsert_project</code>.</div>}

      {projects.map((n) => {
        const age = ageDays(n.updated, today);
        return (
          <div className={`prow${isActive(n) ? "" : " done"}`} key={n.path}>
            <div className="prow-top">
              <button className="linklike" onClick={() => onOpen(n.path)}>{n.title}</button>
              {n.status && <span className={`badge${isActive(n) ? " on" : ""}`}>{n.status}</span>}
              <span className="prow-age">{age === null ? "" : `${age} j`}</span>
            </div>
            {n.summary_l0 && <div className="prow-sub">{n.summary_l0}</div>}
            <div className="prow-meta">
              {n.inDegree} lien{n.inDegree > 1 ? "s" : ""} entrant{n.inDegree > 1 ? "s" : ""} · {n.outDegree} sortant{n.outDegree > 1 ? "s" : ""}
              {n.tags.length > 0 && <> · {n.tags.map((t) => `#${t}`).join(" ")}</>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
