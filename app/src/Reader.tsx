/** File panel: rendered markdown + wiki-links + backlinks, inline editing,
 *  and inbox classification (human routes a staged item to its folder). */

import { useEffect, useMemo, useState } from "react";
import { Marked } from "marked";
import { fetchFile, saveFile, deleteInbox, appendDecision } from "./api";
import { sanitize, safeHref } from "./sanitize";
import type { BrainGraph } from "./types";

// Kill unsafe URL schemes at the token level, before rendering: markdown
// links/images can carry javascript:/data: without any raw HTML. Neutralized
// hrefs point at "#". Defense in depth with the DOM sanitizer below.
const md = new Marked({
  walkTokens(token) {
    if ((token.type === "link" || token.type === "image") && !safeHref((token as { href: string }).href)) {
      (token as { href: string }).href = "#";
    }
  },
});

const CLASSIFY_FOLDERS = ["projects", "people", "context", "personal", "domains"];

export function Reader({
  path,
  graph,
  initialEdit = false,
  onNavigate,
  onClose,
  onSaved,
}: {
  path: string;
  graph: BrainGraph;
  initialEdit?: boolean;
  onNavigate: (path: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(initialEdit);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const isInbox = path.startsWith("inbox/");
  const isDecisions = path.startsWith("decisions/");
  const editable = !isDecisions; // decisions/ is append-only

  const [dest, setDest] = useState(CLASSIFY_FOLDERS[0]);
  const [destName, setDestName] = useState("");

  const resolve = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of graph.nodes) {
      if (n.id) m.set(n.id.toLowerCase(), n.path);
      const stem = n.path.slice(n.path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
      m.set(stem.toLowerCase(), n.path);
    }
    return m;
  }, [graph]);

  const backlinks = useMemo(
    () => graph.edges.filter((e) => e.target === path).map((e) => e.source),
    [graph, path],
  );

  useEffect(() => {
    let dead = false;
    setContent(null);
    setError(null);
    setEditing(initialEdit);
    setNotice(null);
    setDestName(path.replace(/^inbox\//, ""));
    fetchFile(path)
      .then((f) => { if (!dead) { setContent(f.content); setDraft(f.content); } })
      .catch((e) => { if (!dead) setError((e as Error).message); });
    return () => { dead = true; };
  }, [path, initialEdit]);

  const html = useMemo(() => {
    if (content === null) return "";
    const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    // Escape only `<`: it's enough to stop raw HTML tags from opening (the DOM
    // sanitizer is the real gate). Leaving `>` intact lets marked recognize
    // blockquotes (`> …`), which double-escaping `>` had silently broken.
    const escaped = body.replace(/</g, "&lt;");
    const withWiki = escaped.replace(
      /\[\[([^\[\]]+)\]\]/g,
      (_, t: string) => {
        const label = t.trim();
        // `label` can't contain `<` (already escaped) or `[`/`]` (regex class),
        // but may contain `"`; escape it so it can't break out of the attribute
        // and inject a foreign href on this trusted-looking wiki anchor.
        const attr = label.replace(/"/g, "&quot;");
        return `<a class="wiki" data-wiki="${attr}">${label}</a>`;
      },
    );
    return sanitize(md.parse(withWiki, { async: false }) as string);
  }, [content]);

  async function save() {
    setBusy(true);
    setNotice(null);
    try {
      await saveFile(path, draft);
      setContent(draft);
      setEditing(false);
      setNotice("enregistré");
      onSaved();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function classify() {
    const base = destName.trim().replace(/\.md$/i, "");
    if (!/^[\w.-]+$/.test(base)) {
      setNotice("Nom de fichier invalide (lettres, chiffres, . - _ uniquement).");
      return;
    }
    const target = `${dest}/${base}.md`;
    if (graph.nodes.some((n) => n.path === target)) {
      setNotice(`"${target}" existe déjà. Choisis un autre nom.`);
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await saveFile(target, editing ? draft : content ?? "");
      await deleteInbox(path.replace(/^inbox\//, ""));
      onSaved();
      onNavigate(target);
    } catch (e) {
      setNotice((e as Error).message);
      setBusy(false);
    }
  }

  async function toDecision() {
    const body = (editing ? draft : content ?? "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
    setBusy(true);
    setNotice(null);
    try {
      await appendDecision(body);
      await deleteInbox(path.replace(/^inbox\//, ""));
      onSaved();
      onClose();
    } catch (e) {
      setNotice((e as Error).message);
      setBusy(false);
    }
  }

  async function removeInbox() {
    setBusy(true);
    try {
      await deleteInbox(path.replace(/^inbox\//, ""));
      onSaved();
      onClose();
    } catch (e) {
      setNotice((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="reader" role="dialog" aria-label={path}>
      <div className="head">
        <div className="path">{path}</div>
        <div className="head-actions">
          {editable && !editing && content !== null && (
            <button className="box" onClick={() => setEditing(true)}>Éditer</button>
          )}
          <button className="close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
      </div>

      {notice && <div className="notice">{notice}</div>}
      {error && <div className="loading">{error}</div>}
      {content === null && !error && <div className="loading">chargement…</div>}

      {content !== null && !editing && (
        <div
          className="md"
          onClick={(e) => {
            const a = (e.target as HTMLElement).closest("a.wiki") as HTMLElement | null;
            if (!a) return;
            e.preventDefault();
            const target = resolve.get((a.dataset.wiki ?? "").toLowerCase());
            if (target) onNavigate(target);
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}

      {content !== null && editing && (
        <div className="editor">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
          <div className="editor-actions">
            <button className="box" onClick={save} disabled={busy}>{busy ? "…" : "Enregistrer"}</button>
            <button className="box ghost" onClick={() => { setDraft(content); setEditing(false); }} disabled={busy}>Annuler</button>
          </div>
        </div>
      )}

      {isInbox && content !== null && (
        <div className="classify">
          <div className="eyebrow"><span>Classer cet item</span></div>
          <div className="classify-row">
            <select value={dest} onChange={(e) => setDest(e.target.value)}>
              {CLASSIFY_FOLDERS.map((f) => <option key={f} value={f}>{f}/</option>)}
            </select>
            <input value={destName} onChange={(e) => setDestName(e.target.value)} placeholder="nom-du-fichier.md" />
            <button className="box" onClick={classify} disabled={busy}>Ranger</button>
          </div>
          <div className="classify-alt">
            <button className="box ghost" onClick={toDecision} disabled={busy}>→ décision</button>
            <button className="box ghost danger" onClick={removeInbox} disabled={busy}>Supprimer</button>
          </div>
        </div>
      )}

      {backlinks.length > 0 && !editing && (
        <div className="backlinks">
          <div className="eyebrow"><span>Liens entrants · {backlinks.length}</span></div>
          {backlinks.map((b) => (
            <button key={b} onClick={() => onNavigate(b)}>← {b}</button>
          ))}
        </div>
      )}
    </div>
  );
}
