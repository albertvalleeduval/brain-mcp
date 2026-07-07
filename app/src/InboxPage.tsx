/** Inbox (/inbox): staging triage. List what's waiting, drop new files in,
 *  open to classify, or delete once processed. Writes go through the Worker. */

import { useRef, useState } from "react";
import { uploadToInbox, deleteInbox } from "./api";

export function InboxPage({
  items,
  onOpen,
  onReload,
}: {
  items: string[];
  onOpen: (path: string) => void;
  onReload: () => void;
}) {
  const [dropState, setDropState] = useState<"idle" | "over" | "busy" | "done" | "error">("idle");
  const [dropMsg, setDropMsg] = useState("");
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function stage(name: string, content: string) {
    setDropState("busy");
    try {
      const clean = name.replace(/\.(txt|md|markdown)$/i, "") + ".md";
      const res = await uploadToInbox(clean, content);
      setDropState("done");
      setDropMsg(`stagé → ${res.staged}`);
      onReload();
    } catch (e) {
      setDropState("error");
      setDropMsg((e as Error).message);
    }
  }
  async function onFiles(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    stage(f.name, await f.text());
  }

  async function remove(path: string) {
    const filename = path.replace(/^inbox\//, "");
    setBusyPath(path);
    try {
      await deleteInbox(filename);
      onReload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusyPath(null);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Inbox</h1>
        <span className="score">{items.length}<span className="score-max"> en attente</span></span>
      </div>
      <p className="page-sub">
        Zone de staging. Ouvre pour classer, ou dis « <code>ingest</code> » dans une session Claude pour tout ranger d'un coup.
      </p>

      {items.length === 0 && <div className="ok-big">Inbox vide. Rien à classer.</div>}

      {items.map((p) => (
        <div className="hrow" key={p}>
          <span className="sq crit"></span>
          <button className="linklike" onClick={() => onOpen(p)}>{p.replace(/^inbox\//, "")}</button>
          <button className="fix danger-fix" disabled={busyPath === p} onClick={() => remove(p)}>
            {busyPath === p ? "…" : "supprimer"}
          </button>
        </div>
      ))}

      <button
        type="button"
        className={`drop drop-page${dropState === "over" ? " over" : ""}`}
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDropState("over"); }}
        onDragLeave={() => setDropState("idle")}
        onDrop={(e) => { e.preventDefault(); setDropState("idle"); onFiles(e.dataTransfer.files); }}
      >
        {dropState === "busy" ? "envoi…" : dropState === "done" || dropState === "error" ? dropMsg : "déposer un fichier → inbox/"}
      </button>
      <input ref={fileInput} type="file" accept=".md,.txt,.markdown" hidden onChange={(e) => onFiles(e.target.files)} />
    </div>
  );
}
