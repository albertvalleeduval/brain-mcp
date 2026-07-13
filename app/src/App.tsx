import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchGraph, fetchHealth, fetchHistory, fetchFile, fetchReplay, fetchSearch, saveFile, Unauthorized } from "./api";
import type { BrainGraph, HealthReport, Commit, ReplayFrame } from "./types";
import { Sidebar } from "./Sidebar";
import { Graph, type LabelDensity } from "./Graph";
import { Reader } from "./Reader";
import { HealthPage } from "./HealthPage";
import { DecisionsPage } from "./DecisionsPage";
import { ProjetsPage } from "./ProjetsPage";
import { EcheancesPage } from "./EcheancesPage";
import { InboxPage } from "./InboxPage";
import { JournalPage } from "./JournalPage";
import { TensionsPage } from "./TensionsPage";
import { useLocation, parseRoute, navigate, fileUrl, NAV_PATH } from "./router";
import type { NavName } from "./router";
import { useThemeMode } from "./theme";
import { ThemeSwitch } from "./ThemeSwitch";
import { TYPE_COLORS, TYPE_LABELS } from "./palette";

type Boot =
  | { s: "loading" }
  | { s: "unauthorized" }
  | { s: "error"; msg: string }
  | { s: "ready"; graph: BrainGraph; health: HealthReport; history: Commit[]; nowBody: string };

const TYPE_FOR_FOLDER: Record<string, string> = {
  people: "person",
  projects: "project",
  context: "context",
  domains: "reference",
  personal: "personal",
};

/** YYYY-MM-DD in the browser's timezone (the owner is the only user). */
function localDate(): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ s: "loading" });
  const [search, setSearch] = useState("");
  // Thème : auto (coucher du soleil) | clair | sombre — voir theme.ts.
  const { mode: themeMode, theme, setMode: setThemeMode } = useThemeMode();
  // Densité au chargement : « aucun » — le brain s'ouvre nu, les labels
  // viennent à la demande.
  const [density, setDensity] = useState<LabelDensity>(2);
  const [replay, setReplay] = useState<{ frames: ReplayFrame[]; i: number; playing: boolean } | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const timer = useRef<number | null>(null);
  const [contentHits, setContentHits] = useState<Set<string>>(new Set());
  const [pendingEdit, setPendingEdit] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("side-collapsed") === "1");
  const toggleCollapse = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("side-collapsed", next ? "1" : "0");
      return next;
    });
  }, []);

  const route = parseRoute(useLocation());
  const openPath = route.name === "file" ? route.path : null;
  const openFile = useCallback((path: string) => navigate(fileUrl(path)), []);
  const closeFile = useCallback(() => navigate("/"), []);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 3) { setContentHits(new Set()); return; }
    let dead = false;
    const t = window.setTimeout(() => {
      fetchSearch(q)
        .then((r) => { if (!dead) setContentHits(new Set(r.paths)); })
        .catch(() => { if (!dead) setContentHits(new Set()); });
    }, 250);
    return () => { dead = true; window.clearTimeout(t); };
  }, [search]);

  // Forcer le mode édition ne vaut que pour l'ouverture d'un stub fraîchement
  // créé : dès qu'on quitte ce fichier, on oublie, sinon toute revisite rouvre
  // en édition pour le reste de la session.
  useEffect(() => {
    if (pendingEdit && openPath !== pendingEdit) setPendingEdit(null);
  }, [openPath, pendingEdit]);

  const load = useCallback(async () => {
    try {
      const [rawGraph, health, history, now] = await Promise.all([
        fetchGraph(),
        fetchHealth(),
        fetchHistory().catch(() => [] as Commit[]),
        fetchFile("now.md").catch(() => ({ path: "now.md", content: "" })),
      ]);
      // Drop `_`-prefixed meta/template files (e.g. projects/_template.md): they
      // have no real links, so the layout flings them to the sphere's edge as
      // stray outliers. They aren't knowledge, they're scaffolding.
      const isTemplate = (p: string) => p.split("/").pop()!.startsWith("_");
      const graph: BrainGraph = {
        ...rawGraph,
        nodes: rawGraph.nodes.filter((n) => !isTemplate(n.path)),
        edges: rawGraph.edges.filter((e) => !isTemplate(e.source) && !isTemplate(e.target)),
      };
      setBoot({ s: "ready", graph, health, history, nowBody: now.content });
    } catch (e) {
      if (e instanceof Unauthorized) setBoot({ s: "unauthorized" });
      else setBoot({ s: "error", msg: (e as Error).message });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const stalePaths = useMemo(
    () => (boot.s === "ready" ? new Set(boot.health.stale.map((x) => x.path)) : new Set<string>()),
    [boot],
  );

  useEffect(() => {
    if (timer.current) { window.clearInterval(timer.current); timer.current = null; }
    if (replay?.playing) {
      timer.current = window.setInterval(() => {
        setReplay((r) => (r && r.i < r.frames.length - 1 ? { ...r, i: r.i + 1 } : r));
      }, 220);
    }
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [replay?.playing]);

  useEffect(() => {
    if (replay?.playing && replay.i >= replay.frames.length - 1) {
      const t = window.setTimeout(() => setReplay(null), 1100);
      return () => window.clearTimeout(t);
    }
  }, [replay]);

  async function startReplay() {
    if (replay) return;
    setReplayLoading(true);
    try {
      const { frames } = await fetchReplay();
      if (frames.length) setReplay({ frames, i: 0, playing: true });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setReplayLoading(false);
    }
  }

  // Create a stub file for a broken [[link]], then open it in edit mode.
  const createStub = useCallback(async (target: string, path: string) => {
    const folder = path.split("/")[0];
    const stem = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
    const title = stem.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
    const stub =
      `---\nid: ${JSON.stringify(target)}\ntype: ${TYPE_FOR_FOLDER[folder] ?? "note"}\ntags: []\nstatus: draft\n` +
      `summary_l0: "À compléter."\nupdated: ${localDate()}\n---\n\n# ${title}\n\nÀ compléter.\n`;
    try {
      await saveFile(path, stub);
      await load();
      setPendingEdit(path);
      openFile(path);
    } catch (e) {
      alert((e as Error).message);
    }
  }, [load, openFile]);

  if (boot.s === "loading") return <div className="loading">chargement du brain…</div>;

  if (boot.s === "unauthorized") {
    return (
      <div className="gate">
        <h1>my²brain</h1>
        <p>Second brain privé. L'accès demande une session GitHub : le même verrou single-user que le connecteur MCP.</p>
        <a className="box" href="/app/login">Se connecter avec GitHub</a>
      </div>
    );
  }

  if (boot.s === "error") {
    return (
      <div className="gate">
        <h1>my²brain</h1>
        <p>Erreur au chargement : {boot.msg}</p>
        <a className="box" href="/" onClick={(e) => { e.preventDefault(); load(); }}>Réessayer</a>
      </div>
    );
  }

  const { graph, health, history, nowBody } = boot;
  const frame = replay ? replay.frames[replay.i] : null;
  const visible = frame ? new Set(frame.files) : null;

  return (
    <div className="frame">
      <Sidebar
        graph={graph}
        health={health}
        history={history}
        nowBody={nowBody}
        search={search}
        route={route.name}
        collapsed={collapsed}
        onSearch={setSearch}
        onNav={(r: NavName) => navigate(NAV_PATH[r])}
        onCollapse={toggleCollapse}
        themeMode={themeMode}
        themeResolved={theme}
        onThemeSet={setThemeMode}
      />
      <main className="pane">
        {route.name === "health" ? (
          <HealthPage health={health} onOpen={openFile} onCreate={createStub} />
        ) : route.name === "decisions" ? (
          <DecisionsPage graph={graph} />
        ) : route.name === "projets" ? (
          <ProjetsPage graph={graph} today={health.generatedOn} onOpen={openFile} />
        ) : route.name === "echeances" ? (
          <EcheancesPage nowBody={nowBody} today={health.generatedOn} />
        ) : route.name === "inbox" ? (
          <InboxPage items={health.inbox} onOpen={openFile} onReload={load} />
        ) : route.name === "contradictions" ? (
          <TensionsPage graph={graph} onOpen={openFile} />
        ) : route.name === "journal" ? (
          <JournalPage history={history} />
        ) : (
          <>
            <div className="graph-wrap">
              <Graph graph={graph} theme={theme} stalePaths={stalePaths} search={search} contentHits={contentHits} density={density} visible={visible} onOpen={openFile} />
              {/* Toggle de thème : uniquement sur la page graphe, en overlay
                  haut-droite (l'exemplaire permanent vit au pied de la sidebar). */}
              <div className="graph-theme">
                <ThemeSwitch mode={themeMode} resolved={theme} onSet={setThemeMode} />
              </div>
            </div>
            {replay && frame && (
              <div className="replay">
                <button className="box" onClick={() => setReplay({ ...replay, playing: !replay.playing })}>
                  {replay.playing ? "Pause" : "Lecture"}
                </button>
                <input
                  type="range" min={0} max={replay.frames.length - 1} value={replay.i}
                  aria-label="Position dans l'historique"
                  onChange={(e) => setReplay({ ...replay, i: Number(e.target.value), playing: false })}
                />
                <span className="replay-meta">
                  {frame.date.slice(0, 10)} · {frame.files.length} fichiers · commit {replay.i + 1}/{replay.frames.length}
                </span>
              </div>
            )}
            <div className="pane-foot">
              <div className="legend">
                {/* En clair, la couleur code le type : la légende redevient
                    des pastilles. En sombre (monochrome) la caption suffit. */}
                {theme === "light" &&
                  Object.keys(TYPE_LABELS).map((k) => (
                    <span key={k} className="legend-item">
                      <span className="legend-sq" style={{ background: TYPE_COLORS[k] }} aria-hidden="true"></span>
                      {TYPE_LABELS[k]}
                    </span>
                  ))}
                <span>opacité = fraîcheur · pointillé = périmé</span>
              </div>
              <span className="vsep" aria-hidden="true"></span>
              <div className="btns">
                <button className="box" onClick={startReplay} disabled={replayLoading || !!replay}>
                  {replayLoading ? "chargement…" : replay ? "replay…" : "Rejouer l'historique"}
                </button>
                <button className="box" onClick={() => setDensity(((density + 1) % 3) as LabelDensity)}>
                  densité labels : {["hubs", "tous", "aucun"][density]}
                </button>
              </div>
            </div>
          </>
        )}
        {openPath && (
          <Reader
            path={openPath}
            graph={graph}
            initialEdit={pendingEdit === openPath}
            onNavigate={openFile}
            onClose={closeFile}
            onSaved={load}
          />
        )}
      </main>
    </div>
  );
}
