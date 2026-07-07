/** Journal (/journal): the raw git activity of the brain repo, newest first.
 *  Distinct from Décisions (the append-only decision log) — this is "what changed". */

import type { Commit } from "./types";

function relTime(iso: string, now: number): string {
  const ms = now - new Date(iso).getTime();
  const h = ms / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))} min`;
  if (h < 24) return `${Math.round(h)} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "hier" : `${d} j`;
}

function ageClass(iso: string, now: number): string {
  const d = (now - new Date(iso).getTime()) / 86400000;
  if (d < 1) return "a0";
  if (d < 3) return "a1";
  if (d < 7) return "a2";
  return "a3";
}

export function JournalPage({ history }: { history: Commit[] }) {
  const now = Date.now();
  return (
    <div className="page">
      <div className="page-head">
        <h1>Journal</h1>
        <span className="score">{history.length}</span>
      </div>
      <p className="page-sub">
        Activité git du dépôt, la plus récente en haut. Ce qui a changé — pas les décisions.
      </p>

      {history.length === 0 && <div className="ok-big">Aucun commit à afficher.</div>}

      <ol className="jlog">
        {history.map((c) => {
          const [title, ...rest] = c.message.split("\n");
          const body = rest.join("\n").trim();
          return (
            <li className="jrow" key={c.sha}>
              <span className={`jbar ${ageClass(c.date, now)}`}></span>
              <div className="jbody">
                <div className="jtitle">{title}</div>
                {body && <div className="jsub">{body}</div>}
              </div>
              <span className="jtime">{relTime(c.date, now)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
