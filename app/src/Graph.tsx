/**
 * Force graph — UNE mécanique (Q Branch), DEUX peaux (palette.ts → GRAPH_SKINS).
 * Mechanics kept from 1B: single setTransform per frame, continuous wheel zoom
 * toward the cursor, labels = hubs at rest + fade with zoom + hover boost,
 * hover re-inks the neighborhood and dims the rest. Sphère + dérive partout.
 *
 * Sombre : écran d'analyse Skyfall — points gris uniformes sur noir, la
 * fraîcheur dans la valeur de gris, ré-encrage blanc, centre blanc pulsant.
 * Clair : print — couleur = type (dossier), taille ∝ degré, rouge suisse à
 * l'interaction, fraîcheur fondue vers le papier.
 */

import { useEffect, useRef } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";
import type { BrainGraph } from "./types";
import { GRAPH_SKINS, type GraphTheme } from "./palette";

interface SimNode extends SimulationNodeDatum {
  path: string;
  label: string;
  r: number;
  deg: number; // degré total — sert à recalculer r au changement de peau
  folder: string;
  fresh: number; // 0 (récent) → 4 (vieux)
  color: string; // couleur de la peau courante
  stale: boolean;
  hub: boolean;
  center: boolean; // the central "me" node
  match: boolean; // search filter
}
interface SimLink {
  source: SimNode | string;
  target: SimNode | string;
}

export type LabelDensity = 0 | 1 | 2; // hubs | tous | aucun

const MONO = `"IBM Plex Mono", ui-monospace, Consolas, monospace`;
// The central "me" node (graph.centerPath, from the Worker's CENTER_PATH var)
// is pinned at center with a moat of empty space around it.
/** Freshness → mix factor toward the paper: recent files are solid, old ones fade. */
const FRESH_ALPHA = [1, 0.82, 0.64, 0.48, 0.34];

function freshBucket(updated: string | null, todayISO: string): number {
  if (!updated || !/^\d{4}-\d{2}-\d{2}/.test(updated)) return 2;
  const age =
    (new Date(`${todayISO}T00:00:00Z`).getTime() -
      new Date(`${updated.slice(0, 10)}T00:00:00Z`).getTime()) /
    86400000;
  if (age <= 7) return 0;
  if (age <= 30) return 1;
  if (age <= 90) return 2;
  if (age <= 180) return 3;
  return 4;
}

/** Deterministic per-path unit in [0, 1): stable layout across reloads. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 4096) / 4096;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function Graph({
  graph,
  theme,
  stalePaths,
  search,
  contentHits,
  density,
  visible,
  onOpen,
}: {
  graph: BrainGraph;
  /** Peau active — même mécanique, styles GRAPH_SKINS[theme]. */
  theme: GraphTheme;
  stalePaths: Set<string>;
  search: string;
  /** Paths whose BODY matches the search (secondary tier, half ink). */
  contentHits: Set<string>;
  density: LabelDensity;
  /** Replay mode: only these paths are drawn. null = everything. */
  visible: Set<string> | null;
  onOpen: (path: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<{
    nodes: SimNode[];
    links: SimLink[];
    sim: Simulation<SimNode, undefined> | null;
    /** Re-aim every force at a new canvas size (sidebar collapse, window resize). */
    retune: ((w: number, h: number) => void) | null;
    /** Animation clock (ms). Stays 0 under prefers-reduced-motion. */
    time: number;
    k: number;
    tx: number;
    ty: number;
    hover: SimNode | null;
    drag: SimNode | null;
    pan: { x: number; y: number } | null;
    moved: boolean;
  }>({ nodes: [], links: [], sim: null, retune: null, time: 0, k: 1, tx: 0, ty: 0, hover: null, drag: null, pan: null, moved: false });
  const propsRef = useRef({ search, contentHits, density, stalePaths, visible });
  propsRef.current = { search, contentHits, density, stalePaths, visible };
  const skinRef = useRef(GRAPH_SKINS[theme]);
  skinRef.current = GRAPH_SKINS[theme];

  // Rebuild the simulation when the data changes.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const st = stateRef.current;
    const todayISO = new Date().toISOString().slice(0, 10);

    const degrees = graph.nodes.map((n) => n.inDegree + n.outDegree);
    const hubCut = [...degrees].sort((a, b) => b - a)[Math.min(5, degrees.length - 1)] ?? 0;

    st.nodes = graph.nodes.map((n) => {
      const deg = n.inDegree + n.outDegree;
      const center = !!graph.centerPath && n.path === graph.centerPath;
      const skin = skinRef.current;
      return {
        path: n.path,
        label: n.title,
        // Taille et couleur viennent de la peau : sombre = points uniformes
        // gris (la taille n'encode rien, le degré pilote les labels) ; clair =
        // taille ∝ degré, couleur = type (dossier).
        r: skin.radius(deg, center),
        deg,
        folder: n.folder,
        fresh: freshBucket(n.updated, todayISO),
        color: skin.nodeColor(n.folder, center),
        stale: propsRef.current.stalePaths.has(n.path),
        hub: deg >= hubCut && deg > 0,
        center,
        match: true,
        x: undefined,
        y: undefined,
      };
    });
    const byPath = new Map(st.nodes.map((n) => [n.path, n]));
    st.links = graph.edges
      .filter((e) => byPath.has(e.source) && byPath.has(e.target))
      .map((e) => ({ source: e.source, target: e.target }));

    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    st.k = 1; st.tx = 0; st.ty = 0;

    // Pin the central "me" node at the canvas center so the whole brain orbits it.
    const centerNode = st.nodes.find((d) => d.center);
    if (centerNode) {
      centerNode.x = w / 2; centerNode.y = h / 2;
      centerNode.fx = w / 2; centerNode.fy = h / 2;
    }

    // The brain is a SPHERE, à la Skyfall. Each node gets a deterministic
    // target radius sampled like a point on a 3D ball projected to 2D
    // (r = R·√(1−z²), z uniform): dense at the rim, sparser through the core —
    // exactly the silhouette of a wireframe sphere. Links pulling across the
    // volume produce the tangle. The radial force is the dominant one; charge
    // and links stay weak so they texture the ball without deforming it.
    const z = (d: SimNode) => 2 * hash01(d.path) - 1;

    st.sim?.stop();
    st.sim = forceSimulation<SimNode>(st.nodes)
      .force("link", forceLink<SimNode, any>(st.links).id((d: SimNode) => d.path).strength(0.12))
      .force("charge", forceManyBody<SimNode>().strength((d) => (d.center ? -220 : -26)))
      .force("center", forceCenter(w / 2, h / 2).strength(0.5))
      // A small moat keeps the white core readable without hollowing the ball.
      .force("collide", forceCollide<SimNode>((d) => (d.center ? d.r + 20 : d.r + 3)))
      .force("sphere", forceRadial<SimNode>(0, w / 2, h / 2).strength((d) => (d.center ? 0 : 0.85)))
      .on("tick", draw);

    // All size-dependent targets live here so the sphere can chase the canvas
    // when it resizes (sidebar collapse): re-aim, don't rebuild.
    st.retune = (nw: number, nh: number) => {
      const R = Math.min(nw, nh) * 0.34;
      const targetR = (d: SimNode) => (d.center ? 0 : R * Math.sqrt(1 - z(d) * z(d)));
      if (centerNode) { centerNode.fx = nw / 2; centerNode.fy = nh / 2; }
      (st.sim!.force("link") as any).distance((l: any) => (l.source.center || l.target.center ? R * 0.55 : 40));
      (st.sim!.force("charge") as any).distanceMax(R * 0.9);
      (st.sim!.force("center") as any).x(nw / 2).y(nh / 2);
      (st.sim!.force("sphere") as any).radius(targetR).x(nw / 2).y(nh / 2);
    };
    st.retune(w, h);

    return () => { st.sim?.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // Changement de peau : recalcule taille + couleur de chaque nœud (les
  // positions restent), re-seed la collision (elle met ses rayons en cache)
  // et réchauffe doucement pour que les nouvelles tailles se fassent la place.
  useEffect(() => {
    const st = stateRef.current;
    if (!st.nodes.length) return;
    const skin = GRAPH_SKINS[theme];
    for (const n of st.nodes) {
      n.r = skin.radius(n.deg, n.center);
      n.color = skin.nodeColor(n.folder, n.center);
    }
    st.sim?.force("collide", forceCollide<SimNode>((d) => (d.center ? d.r + 20 : d.r + 3)));
    st.sim?.alpha(0.2).restart();
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // Re-draw (no re-sim) when display props change.
  useEffect(() => {
    const st = stateRef.current;
    const q = search.trim().toLowerCase();
    for (const n of st.nodes) {
      n.match = !q || n.path.toLowerCase().includes(q) || n.label.toLowerCase().includes(q);
      n.stale = stalePaths.has(n.path);
    }
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, contentHits, density, stalePaths, visible]);

  /** Drift: each node wanders around its resting spot, a deterministic ~3px
   *  orbit per path (two superposed sines → organic, not metronomic). Pure
   *  display offset — physics and hit-testing keep the true positions. The
   *  pinned center doesn't drift, it pulses. */
  function wob(st: { time: number }, n: SimNode): [number, number] {
    if (n.center || st.time === 0) return [n.x!, n.y!];
    const t = st.time * 0.0007;
    const p = hash01(n.path) * Math.PI * 2;
    const dx = (Math.sin(t + p * 3.1) * 0.7 + Math.sin(t * 1.9 + p * 5.3) * 0.3) * 3.2;
    const dy = (Math.cos(t * 0.83 + p * 1.7) * 0.7 + Math.cos(t * 1.53 + p * 4.1) * 0.3) * 3.2;
    return [n.x! + dx, n.y! + dy];
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const st = stateRef.current;
    const skin = skinRef.current;
    const { density } = propsRef.current;
    const { visible } = propsRef.current;
    const ctx = canvas.getContext("2d")!;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.setTransform(dpr * st.k, 0, 0, dpr * st.k, dpr * st.tx, dpr * st.ty);

    const hover = st.hover;
    const neigh = new Set<SimNode>();
    if (hover) {
      for (const l of st.links) {
        const s = l.source as SimNode, t = l.target as SimNode;
        if (s === hover) neigh.add(t);
        if (t === hover) neigh.add(s);
      }
    }
    const searching = propsRef.current.search.trim().length > 0;

    // Correctif netteté n°1 : plancher de taille ÉCRAN pour les nœuds. En
    // dézoomant, r×k passait sous ~2px et l'antialiasing transformait chaque
    // disque en tache molle. Le rayon dessiné ne descend jamais sous 2.5px
    // écran ; à zoom normal (k ≥ 0.84) le plancher est inactif.
    const rd = (n: SimNode) => Math.max(n.r, 2.5 / st.k);

    // Contour de survol (reticle HUD) : le disque + un petit gap. Défini ici
    // pour que les arêtes surlignées partent du BORD du contour, pas du disque
    // — sinon un bout d'arête passe visiblement sous l'anneau.
    const HOVER_GAP = 2.5 / st.k;
    const HOVER_LW = 1.2 / st.k;
    const ringR = (n: SimNode) => rd(n) + HOVER_GAP;
    // Rayon de coupe d'une arête à une extrémité : bord extérieur du contour si
    // le nœud est survolé (l'arête démarre juste hors de l'anneau), bord du
    // disque sinon.
    const trimR = (n: SimNode) => (n === hover ? ringR(n) + HOVER_LW / 2 : rd(n));

    // edges
    for (const l of st.links) {
      const s = l.source as SimNode, t = l.target as SimNode;
      if (s.x == null || t.x == null) continue;
      if (visible && !(visible.has(s.path) && visible.has(t.path))) continue;
      const on = hover && (s === hover || t === hover);
      const dimmed = (hover && !on) || (searching && !(s.match && t.match));
      ctx.strokeStyle = on ? skin.edgeOn : dimmed ? skin.edgeDim : skin.edge;
      ctx.lineWidth = 1 / st.k;
      const [sx, sy] = wob(st, s);
      const [tx2, ty2] = wob(st, t);
      // L'arête s'arrête au BORD des deux disques, jamais dans le nœud :
      // on retranche le rayon de chaque extrémité le long de la
      // direction. Si les disques se chevauchent, pas d'arête à tracer.
      const dx = tx2 - sx, dy = ty2 - sy;
      const len = Math.hypot(dx, dy);
      const sr = trimR(s), tr = trimR(t);
      if (len <= sr + tr) continue;
      const ux = dx / len, uy = dy / len;
      ctx.beginPath();
      ctx.moveTo(sx + ux * sr, sy + uy * sr);
      ctx.lineTo(tx2 - ux * tr, ty2 - uy * tr);
      ctx.stroke();
    }

    // labels fade in with zoom; hover always shows its neighborhood.
    const zoomAlpha = smoothstep(1.15, 2.0, st.k);

    const { contentHits } = propsRef.current;

    // Labels are collected here and drawn in a second pass, AFTER every node,
    // so text always sits on top of the constellation instead of being
    // overpainted by whatever node happens to render later.
    const labels: { n: SimNode; alpha: number; strong: boolean; dimmed: boolean }[] = [];

    for (const n of st.nodes) {
      if (n.x == null) continue;
      if (visible && !visible.has(n.path)) continue;
      const isHover = n === hover;
      const isNeigh = neigh.has(n);
      // Search tiers: title/path match = full ink; body-only match = half ink.
      const secondary = searching && !n.match && contentHits.has(n.path);
      const dimmed = (hover && !isHover && !isNeigh) || (searching && !n.match && !secondary);
      const [nx, ny] = wob(st, n);

      ctx.beginPath();
      ctx.arc(nx, ny, rd(n), 0, Math.PI * 2);
      if (n.stale) {
        // Disque couleur papier d'abord : l'anneau pointillé est creux, mais
        // les arêtes ne doivent pas se voir à travers le nœud pour autant.
        ctx.fillStyle = skin.paperCss;
        ctx.fill();
        ctx.setLineDash([3 / st.k, 3 / st.k]);
        ctx.strokeStyle = dimmed ? skin.dim : skin.mix(n.color, isHover || dimmed ? 1 : secondary ? 0.4 : 0.75);
        ctx.lineWidth = 1.3 / st.k;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // Nœuds = disques NETS. Le glow par nœud
        // (shadowBlur 7px sur un rayon de 3.5) transformait chaque point en
        // boule cotonneuse et, empilé sur des centaines de nœuds, voilait tout
        // le brain — c'était ça le « pas net ». Seul le nœud central « me »
        // garde un halo (pulsant, ~4s), pour rester l'ancre lumineuse.
        if (!dimmed && n.center) {
          ctx.shadowColor = skin.centerHalo;
          // Correctif nettete n°2 : shadowBlur est en px ECRAN (ignore le
          // world transform), donc a taille constante il voilait tout le
          // centre au dezoom. On le multiplie par k : le halo vit en
          // coordonnees monde et retrecit avec le brain.
          ctx.shadowBlur = (16 + 6 * Math.sin(st.time * 0.0016)) * st.k;
        }
        // Opaque toujours : la fraîcheur vit dans la couleur, pas dans l'alpha.
        const f = isHover ? 1 : secondary ? 0.4 : FRESH_ALPHA[n.fresh];
        ctx.fillStyle = dimmed ? skin.dim : skin.mix(n.color, f);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      if (isHover) {
        // Ring around the node needs a gap to read: a thin reticle at r+2.5,
        // like an HUD target lock (blanc en sombre, rouge suisse en clair). Les
        // arêtes surlignées démarrent du bord de cet anneau (cf. trimR), jamais
        // du disque : rien ne passe sous le contour.
        ctx.beginPath();
        ctx.arc(nx, ny, ringR(n), 0, Math.PI * 2);
        ctx.strokeStyle = skin.accent;
        ctx.lineWidth = HOVER_LW;
        ctx.shadowColor = skin.accent;
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      let alpha = 0;
      if (isHover || isNeigh) alpha = 1;
      else if (secondary) alpha = 0; // half-ink dot only, no label noise
      else if (!dimmed && density === 1) alpha = Math.max(zoomAlpha, 0.9);
      else if (!dimmed && density === 0) alpha = n.hub ? 1 : zoomAlpha;
      if (searching && n.match && !dimmed) alpha = 1; // primary matches always labeled
      if (density === 2 && !isHover && !isNeigh) alpha = 0;
      if (alpha > 0.02) labels.push({ n, alpha, strong: isHover || isNeigh, dimmed });
    }

    // Second pass: labels on top. Centered UNDER the node and lifted off the
    // busy background by a paper-colored halo so the text stays readable even
    // where it crosses other nodes or edges.
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const { n, alpha, strong, dimmed } of labels) {
      ctx.globalAlpha = alpha;
      // Mono uppercase tags, like the file designations on the MI6 screen.
      ctx.font = `${strong ? 600 : 400} ${9.5 / st.k}px ${MONO}`;
      const text = n.label.toUpperCase();
      const [lx, ly] = wob(st, n);
      const x = lx;
      const y = ly + rd(n) + 5 / st.k;
      ctx.lineJoin = "round";
      ctx.lineWidth = 3 / st.k;
      ctx.strokeStyle = skin.labelHalo;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = dimmed ? skin.dim : strong ? skin.ink : skin.label;
      ctx.fillText(text, x, y);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  // The brain never quite sleeps: a rAF clock drives the center node's slow
  // breathing and the ~1px micro-drift of every other node. Killed entirely
  // under prefers-reduced-motion (time stays 0 → static offsets).
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const st = stateRef.current;
    let raf = 0;
    const loop = (t: number) => {
      st.time = t;
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Interactions.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const st = stateRef.current;

    const toWorld = (cx: number, cy: number): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      return [(cx - rect.left - st.tx) / st.k, (cy - rect.top - st.ty) / st.k];
    };
    const hit = (cx: number, cy: number): SimNode | null => {
      const [wx, wy] = toWorld(cx, cy);
      let best: SimNode | null = null, bd = Infinity;
      const vis = propsRef.current.visible;
      for (const n of st.nodes) {
        if (n.x == null) continue;
        if (vis && !vis.has(n.path)) continue;
        const d = Math.hypot(wx - n.x!, wy - n.y!);
        if (d < n.r + 6 / st.k && d < bd) { best = n; bd = d; }
      }
      return best;
    };

    const onMove = (ev: MouseEvent) => {
      if (st.drag) {
        const [wx, wy] = toWorld(ev.clientX, ev.clientY);
        st.drag.fx = wx; st.drag.fy = wy;
        st.sim?.alphaTarget(0.25).restart();
        st.moved = true;
        return;
      }
      if (st.pan) {
        st.tx += ev.clientX - st.pan.x;
        st.ty += ev.clientY - st.pan.y;
        st.pan = { x: ev.clientX, y: ev.clientY };
        st.moved = true;
        draw();
        return;
      }
      const h = hit(ev.clientX, ev.clientY);
      if (h !== st.hover) {
        st.hover = h;
        canvas.style.cursor = h ? "pointer" : "default";
        draw();
      }
    };
    const onDown = (ev: MouseEvent) => {
      st.moved = false;
      const h = hit(ev.clientX, ev.clientY);
      if (h) st.drag = h;
      else st.pan = { x: ev.clientX, y: ev.clientY };
    };
    const onUp = (ev: MouseEvent) => {
      if (st.drag) {
        st.drag.fx = null; st.drag.fy = null;
        st.sim?.alphaTarget(0);
      }
      const wasClick = !st.moved;
      const target = st.drag ?? (wasClick ? hit(ev.clientX, ev.clientY) : null);
      st.drag = null; st.pan = null;
      if (wasClick && target) onOpenRef.current(target.path);
    };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const f = Math.exp(-ev.deltaY * 0.0016); // continuous zoom toward cursor
      const nk = Math.min(6, Math.max(0.35, st.k * f));
      const cx = ev.clientX - rect.left, cy = ev.clientY - rect.top;
      st.tx = cx - ((cx - st.tx) / st.k) * nk;
      st.ty = cy - ((cy - st.ty) / st.k) * nk;
      st.k = nk;
      draw();
    };
    const onLeave = () => { st.hover = null; draw(); };
    // Follow the canvas as it resizes (sidebar slide, window resize): re-aim
    // the forces at the new center and reheat, so the sphere glides along.
    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && st.retune) {
        st.retune(rect.width, rect.height);
        st.sim?.alpha(0.3).restart();
      }
      draw();
    });

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mouseleave", onLeave);
    ro.observe(canvas);
    return () => {
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mouseleave", onLeave);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  return <canvas ref={canvasRef} aria-label="Graph des fichiers du brain" />;
}
