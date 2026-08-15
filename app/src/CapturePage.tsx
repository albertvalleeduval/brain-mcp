/** Capture (/capture): the phone's standalone capture surface.
 *
 *  Replaces the Notes-app black hole. Design constraints, in order:
 *
 *  1. Instant. Rendered before the graph loads (App returns early on this
 *     route), no sidebar, nothing to wait for.
 *  2. Never loses an idea. The text is queued in localStorage BEFORE the
 *     network is touched, so a dead tunnel or an expired session costs
 *     nothing — the queue flushes on next load and on `online`.
 *  3. Never classifies. No folder, no tag, no title. Per ingestion-protocol,
 *     capture is dumb; the triage session does the thinking later.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { captureIdea, HttpError, Unauthorized } from "./api";

const QUEUE_KEY = "capture-queue";
const REJECTED_KEY = "capture-rejected";

/** Server-side hard limit on one capture (ops.ts). Checked here too so a long
 *  dictation is refused BEFORE it enters the queue, text still in the box. */
const MAX_LEN = 4000;

/** Pré-assignation faite à la capture, tant que le contexte est en tête.
 *  Ne remplace pas le tri du soir : lui épargne une devinette. */
const KINDS: [string, string][] = [
  ["todo", "To-do"],
  ["reflexion", "Réflexion"],
  ["projet", "Projet"],
  ["question", "Question"],
];

interface Pending {
  id: string;
  text: string;
  kind?: string;
}

/** A capture the server refused for good (4xx): kept OUT of the queue so it
 *  can't block the ideas behind it, kept visible so its text isn't lost. */
interface Rejected extends Pending {
  reason: string;
}

function readStore<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function writeStore<T>(key: string, items: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    /* quota or private mode — the in-memory state still carries the session */
  }
}

const readQueue = () => readStore<Pending>(QUEUE_KEY);
const writeQueue = (q: Pending[]) => writeStore(QUEUE_KEY, q);
const readRejected = () => readStore<Rejected>(REJECTED_KEY);
const writeRejected = (r: Rejected[]) => writeStore(REJECTED_KEY, r);

/** 4xx = the server will refuse this capture forever (too long, looks like a
 *  secret…) — retrying it would jam the queue. 401 is a session matter, and
 *  408/429 are transient despite being 4xx. */
function isPermanentRefusal(e: unknown): e is HttpError {
  return (
    e instanceof HttpError &&
    e.status >= 400 &&
    e.status < 500 &&
    e.status !== 401 &&
    e.status !== 408 &&
    e.status !== 429
  );
}

export function CapturePage() {
  const [text, setText] = useState("");
  const [queue, setQueue] = useState<Pending[]>(readQueue);
  const [rejected, setRejected] = useState<Rejected[]>(readRejected);
  const [expired, setExpired] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const flushing = useRef(false);

  /** Drain the queue oldest-first. Stops at the first TRANSIENT failure so
   *  order holds; a permanent refusal moves aside and the drain continues.
   *
   *  The queue is RE-READ at every step and entries are removed by id, never
   *  by position: submit() may append while a send is in flight (flush() is
   *  already running, so its call is a no-op), and rewriting the store from a
   *  pre-send snapshot would erase that capture unsent. */
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      for (;;) {
        const head = readQueue()[0];
        if (!head) break;
        try {
          await captureIdea(head.text, head.kind);
        } catch (e) {
          if (isPermanentRefusal(e)) {
            const r = [...readRejected(), { ...head, reason: e.message }];
            writeRejected(r);
            setRejected(r);
            const rest = readQueue().filter((x) => x.id !== head.id);
            writeQueue(rest);
            setQueue(rest);
            continue;
          }
          if (e instanceof Unauthorized) setExpired(true);
          else setErr((e as Error).message);
          break;
        }
        const rest = readQueue().filter((x) => x.id !== head.id);
        writeQueue(rest);
        setQueue(rest);
        setErr(null);
        setExpired(false);
      }
    } finally {
      flushing.current = false;
    }
  }, []);

  useEffect(() => {
    flush();
    const on = () => flush();
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, [flush]);

  /* Cale la page sur la zone RÉELLEMENT visible, clavier déduit.
   *
   * Sans ça le champ mange toute la hauteur et pousse le bouton d'envoi sous
   * le clavier : il faut refermer le clavier pour envoyer, ce qui ruine la
   * capture à une main. Ni vh ni dvh ne connaissent le clavier virtuel — seul
   * visualViewport le voit. Le champ étant en flex, il se réduit tout seul et
   * le bouton reste juste au-dessus des touches, quelle que soit la hauteur du
   * clavier ou du téléphone. Une taille fixe, elle, le placerait trop haut. */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return; // repli CSS : 100dvh
    const apply = () => {
      const s = document.documentElement.style;
      s.setProperty("--cap-h", `${vv.height}px`);
      s.setProperty("--cap-top", `${vv.offsetTop}px`);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      const s = document.documentElement.style;
      s.removeProperty("--cap-h");
      s.removeProperty("--cap-top");
    };
  }, []);

  function submit(kind?: string) {
    const clean = text.trim();
    if (!clean) return;
    if (clean.length > MAX_LEN) {
      // Refused before queueing, text kept in the box: once queued the server
      // would 413 it forever, and the user can still shorten it here.
      setErr(`Trop long pour une capture (${MAX_LEN} caractères max) — raccourcis ou coupe en deux.`);
      return;
    }
    // Queue first, clear second, send third. The box empties instantly and the
    // idea is already durable — the network is never in the critical path.
    const q = [...readQueue(), { id: crypto.randomUUID(), text: clean, kind }];
    writeQueue(q);
    setQueue(q);
    setText("");
    setErr(null);
    box.current?.focus();
    flush();
  }

  function discardRejected(id: string) {
    const r = readRejected().filter((x) => x.id !== id);
    writeRejected(r);
    setRejected(r);
  }

  return (
    <div className="capture">
      {/* Rien d'autre que l'ampoule et le mot. Aucune légende, aucun état
          décoratif : cette page sert à se vider la tête, et tout texte affiché
          y remet quelque chose. L'ampoule est la seule sortie vers le cockpit
          — un lien sans texte, pour ne pas inviter à la consultation au moment
          où on essaie juste de noter. */}
      <a className="capture-head" href="/" aria-label="Ouvrir le cockpit">
        <svg
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
          strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true"
        >
          <circle cx="12" cy="10" r="4.6" />
          <line x1="9.6" y1="16.4" x2="14.4" y2="16.4" />
          <line x1="10.4" y1="19" x2="13.6" y2="19" />
        </svg>
        <span className="capture-title">Idée</span>
      </a>

      <textarea
        ref={box}
        className="capture-box"
        value={text}
        autoFocus
        placeholder="Une idée qui passe…"
        aria-label="Votre idée"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Ctrl/Cmd+Entrée pour le desktop ; sur mobile c'est le bouton, et
          // Entrée doit rester un retour à la ligne (dictée Gboard).
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />

      <div className="capture-kinds">
        {KINDS.map(([k, label]) => (
          <button key={k} className="capture-kind" onClick={() => submit(k)} disabled={!text.trim()}>
            {label}
          </button>
        ))}
      </div>

      {/* Le bouton neutre reste : sur mobile, Entrée doit rester un retour à la
          ligne (dictée), donc il n'existe aucun autre moyen d'envoyer sans
          pré-trier. C'est une nécessité fonctionnelle, pas de la décoration. */}
      <button className="capture-send" onClick={() => submit()} disabled={!text.trim()}>
        Envoyer
      </button>

      {/* Muet quand tout va bien. Ne parle que si quelque chose cloche ou reste
          en attente : masquer un échec serait pire que d'afficher du texte. */}
      <div className="capture-foot">
        {expired ? (
          <span className="capture-warn">
            Session expirée. <a href="/app/login">Se reconnecter</a> — {queue.length} en attente, rien n'est perdu.
          </span>
        ) : queue.length > 0 ? (
          <span className="capture-warn">{queue.length} en attente, renvoyée{queue.length > 1 ? "s" : ""} au retour du réseau.</span>
        ) : err ? (
          <span className="capture-warn">{err}</span>
        ) : null}

        {/* Refus définitifs du serveur : hors de la file (ils ne bloquent plus
            les suivantes) mais jamais effacés en silence — le texte reste
            lisible et copiable jusqu'à un abandon explicite. */}
        {rejected.map((r) => (
          <div className="capture-rejected" key={r.id}>
            <span className="capture-warn">Refusée : {r.reason}</span>
            <p className="capture-rejected-text">{r.text}</p>
            <button className="capture-rejected-drop" onClick={() => discardRejected(r.id)}>
              Abandonner
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
