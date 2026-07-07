/** Échéances (/echeances): the full list of deadlines parsed from now.md,
 *  soonest first. Source of truth is now.md's "## Deadlines proches". */

import { parseDeadlines } from "./nowparse";

export function EcheancesPage({ nowBody, today }: { nowBody: string; today: string }) {
  const deadlines = parseDeadlines(nowBody, today)
    .slice()
    .sort((a, b) => {
      if (a.daysLeft === null) return 1;
      if (b.daysLeft === null) return -1;
      return a.daysLeft - b.daysLeft;
    });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Échéances</h1>
        <span className="score">{deadlines.length}</span>
      </div>
      <p className="page-sub">
        Depuis <code>now.md</code> · section « Deadlines proches ». Les plus proches en tête. Édite <code>now.md</code> pour les changer.
      </p>

      {deadlines.length === 0 && <div className="ok-big">Aucune échéance dans now.md.</div>}

      {deadlines.map((d, i) => {
        const urgent = d.daysLeft !== null && d.daysLeft <= 7;
        const past = d.daysLeft !== null && d.daysLeft < 0;
        return (
          <div className={`erow${urgent ? " urgent" : ""}${past ? " past" : ""}`} key={i}>
            <span className="erow-date">
              {d.day}
              <small>{d.month}</small>
            </span>
            <span className="erow-text">{d.text}</span>
            <span className="erow-left">
              {d.daysLeft === null ? "" : past ? `dépassé de ${-d.daysLeft} j` : `J-${d.daysLeft}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
