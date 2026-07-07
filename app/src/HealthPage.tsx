/** Full health report as its own page (/health), with fix affordances. */

import type { HealthReport } from "./types";

/** Guess the file a broken [[wiki-target]] should live at, from its id prefix
 *  (person-jane → people/jane.md, project-x → projects/x.md, …). null if unsure. */
export function guessPath(target: string): string | null {
  const t = target.trim().toLowerCase().replace(/\s+/g, "-");
  const map: Record<string, string> = {
    person: "people",
    project: "projects",
    context: "context",
    domain: "domains",
  };
  const dash = t.indexOf("-");
  if (dash > 0) {
    const folder = map[t.slice(0, dash)];
    if (folder) return `${folder}/${t.slice(dash + 1)}.md`;
  }
  if (t.startsWith("decision")) return null; // append-only, not creatable here
  return null;
}

export function HealthPage({
  health,
  onOpen,
  onCreate,
}: {
  health: HealthReport;
  onOpen: (path: string) => void;
  onCreate: (target: string, path: string) => void;
}) {
  const nothing =
    !health.stale.length && !health.brokenLinks.length && !health.orphans.length && !health.missingSummaries.length;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Santé du brain</h1>
        <span className="score">{health.score}<span className="score-max">/100</span></span>
      </div>
      <p className="page-sub">
        {health.files} fichiers · généré le {health.generatedOn}. Les orphelins sont signalés mais ne coûtent pas de points.
      </p>

      {nothing && <div className="ok-big">Rien à signaler. Le brain est propre.</div>}

      {health.brokenLinks.length > 0 && (
        <section className="hsec crit">
          <div className="eyebrow"><span>Liens cassés</span><span className="count">{health.brokenLinks.length}</span></div>
          {health.brokenLinks.map((b, i) => {
            const guess = guessPath(b.target);
            return (
              <div className="hrow" key={i}>
                <span className="sq crit"></span>
                <button className="linklike" onClick={() => onOpen(b.source)}>{b.source}</button>
                <span className="arrow">→ [[{b.target}]]</span>
                {guess ? (
                  <button className="fix" onClick={() => onCreate(b.target, guess)}>créer {guess}</button>
                ) : (
                  <span className="fix-na">cible ambiguë</span>
                )}
              </div>
            );
          })}
        </section>
      )}

      {health.stale.length > 0 && (
        <section className="hsec">
          <div className="eyebrow"><span>Périmés</span><span className="count">{health.stale.length}</span></div>
          {health.stale.map((s) => (
            <div className="hrow" key={s.path}>
              <span className="sq crit"></span>
              <button className="linklike" onClick={() => onOpen(s.path)}>{s.path}</button>
              <span className="meta">{s.ageDays} j · TTL {s.ttlDays} j</span>
            </div>
          ))}
        </section>
      )}

      {health.missingSummaries.length > 0 && (
        <section className="hsec">
          <div className="eyebrow"><span>Sans summary_l0</span><span className="count">{health.missingSummaries.length}</span></div>
          {health.missingSummaries.map((p) => (
            <div className="hrow" key={p}>
              <span className="sq"></span>
              <button className="linklike" onClick={() => onOpen(p)}>{p}</button>
              <button className="fix" onClick={() => onOpen(p)}>éditer</button>
            </div>
          ))}
        </section>
      )}

      {health.orphans.length > 0 && (
        <section className="hsec">
          <div className="eyebrow"><span>Orphelins</span><span className="count">{health.orphans.length}</span></div>
          <p className="page-sub">Aucun lien entrant. Injoignables en naviguant les liens. Pas une pénalité, juste une info.</p>
          {health.orphans.map((p) => (
            <div className="hrow" key={p}>
              <span className="sq"></span>
              <button className="linklike" onClick={() => onOpen(p)}>{p}</button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
