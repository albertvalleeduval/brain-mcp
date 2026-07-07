/** Decisions timeline (/decisions): every dated "## YYYY-MM-DD" entry across
 *  decisions/*.md, newest first. decisions/ is append-only, so read-only here. */

import { useEffect, useState } from "react";
import { fetchFile } from "./api";
import type { BrainGraph } from "./types";

interface Entry {
  date: string;
  month: string; // source file, e.g. "2026-07"
  text: string;
}

function parseEntries(month: string, content: string): Entry[] {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const out: Entry[] = [];
  const re = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/gm;
  let m: RegExpExecArray | null;
  const marks: { date: string; start: number; end: number }[] = [];
  while ((m = re.exec(body))) marks.push({ date: m[1], start: re.lastIndex, end: 0 });
  marks.forEach((mk, i) => {
    mk.end = i + 1 < marks.length ? body.indexOf("## ", mk.start) : body.length;
    const next = body.indexOf("\n## ", mk.start);
    mk.end = next === -1 ? body.length : next;
    out.push({ date: mk.date, month, text: body.slice(mk.start, mk.end).trim() });
  });
  return out;
}

export function DecisionsPage({ graph }: { graph: BrainGraph }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const files = graph.nodes.filter((n) => n.folder === "decisions").map((n) => n.path);
    Promise.all(files.map((p) => fetchFile(p).then((f) => ({ p, c: f.content })).catch(() => null)))
      .then((results) => {
        const all: Entry[] = [];
        for (const r of results) {
          if (!r) continue;
          const month = r.p.replace(/^decisions\//, "").replace(/\.md$/, "");
          all.push(...parseEntries(month, r.c));
        }
        all.sort((a, b) => b.date.localeCompare(a.date));
        setEntries(all);
      })
      .catch((e) => setError((e as Error).message));
  }, [graph]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Décisions</h1>
      </div>
      <p className="page-sub">Journal append-only, la plus récente en haut. Lecture seule.</p>

      {error && <div className="loading">{error}</div>}
      {entries === null && !error && <div className="loading">chargement…</div>}
      {entries && entries.length === 0 && <div className="ok-big">Aucune décision consignée.</div>}

      <ol className="timeline">
        {entries?.map((e, i) => (
          <li className="tl-item" key={i}>
            <div className="tl-date">{e.date}</div>
            <div className="tl-body">{e.text}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
