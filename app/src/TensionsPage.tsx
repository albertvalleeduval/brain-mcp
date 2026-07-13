/** Contradictions (/contradictions): the brain's critical mind. Lists the
 *  tensions/ ledger — detected incoherences between facts, decisions and
 *  principles — open ones first. Click one to adjudicate it in the Reader
 *  (flip status + write the why). */

import type { BrainGraph } from "./types";

const STATUS_LABEL: Record<string, string> = {
  open: "ouverte",
  resolved: "résolue",
  "false-alarm": "faux positif",
  superseded: "supersédée",
};

function statusOf(s: string | null): string {
  return (s ?? "open").toLowerCase();
}

export function TensionsPage({
  graph,
  onOpen,
}: {
  graph: BrainGraph;
  onOpen: (path: string) => void;
}) {
  const tensions = graph.nodes.filter((n) => n.folder === "tensions");
  const isReadme = (p: string) => p.toLowerCase().endsWith("readme.md");
  const items = tensions.filter((n) => !isReadme(n.path));

  const rank = (s: string | null) => (statusOf(s) === "open" ? 0 : 1);
  const sorted = [...items].sort(
    (a, b) => rank(a.status) - rank(b.status) || (b.updated ?? "").localeCompare(a.updated ?? ""),
  );
  const openCount = items.filter((n) => statusOf(n.status) === "open").length;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Contradictions</h1>
        <span className="score">
          {openCount}
          <span className="score-max"> ouverte{openCount > 1 ? "s" : ""}</span>
        </span>
      </div>
      <p className="page-sub">
        L'esprit critique du brain : tensions détectées entre faits, décisions et principes. Ouvre-en
        une pour trancher (résoudre / faux positif / supersédée) en écrivant le pourquoi.
      </p>

      {items.length === 0 && (
        <div className="ok-big">
          Aucune tension consignée. Lance une passe de cohérence pour en chercher.
        </div>
      )}

      {sorted.map((t) => {
        const st = statusOf(t.status);
        const open = st === "open";
        return (
          <div className={`prow${open ? "" : " done"}`} key={t.path}>
            <div className="prow-top">
              <button className="linklike" onClick={() => onOpen(t.path)}>
                {t.title}
              </button>
              <span className={`badge${open ? " on" : ""}`}>{STATUS_LABEL[st] ?? st}</span>
            </div>
            {t.summary_l0 && <div className="prow-sub">{t.summary_l0}</div>}
          </div>
        );
      })}
    </div>
  );
}
