/**
 * Force graph, direction 1B: canvas + d3-force (compacted for ~60 nodes):
 * single setTransform per frame, continuous wheel zoom toward the cursor,
 * labels = hubs at rest + fade with zoom + hover boost, hover re-inks the
 * neighborhood and dims the rest.
 *
 * Visual language (design/guidelines.md): fill color = type (folder),
 * opacity = freshness, dashed outline = stale (past TTL), red = hover only.
 */

import { useEffect, useRef } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";
import type { BrainGraph } from "./types";
import { typeColor } from "./palette";

interface SimNode extends SimulationNodeDatum {
  path: string;
  label: string;
  r: number;
  fresh: number; // 0 (récent) → 4 (vieux)
  color: string; // type color (folder)
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

const INK = "#111111";
const ACCENT = "#e2231a";
const RULE = "#dddddd";
// The central "me" node (graph.centerPath, from the Worker's CENTER_PATH var)
// is pinned at center with a moat of empty space around it.
/** Freshness → fill opacity: recent files are solid, old ones fade. */
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

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function Graph({
  graph,
  stalePaths,
  search,
  contentHits,
  density,
  visible,
  onOpen,
}: {
  graph: BrainGraph;
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
    k: number;
    tx: number;
    ty: number;
    hover: SimNode | null;
    drag: SimNode | null;
    pan: { x: number; y: number } | null;
    moved: boolean;
  }>({ nodes: [], links: [], sim: null, k: 1, tx: 0, ty: 0, hover: null, drag: null, pan: null, moved: false });
  const propsRef = useRef({ search, contentHits, density, stalePaths, visible });
  propsRef.current = { search, contentHits, density, stalePaths, visible };

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
      return {
        path: n.path,
        label: n.title,
        r: 3.5 + Math.sqrt(deg) * 2.2 + (center ? 5 : 0),
        fresh: freshBucket(n.updated, todayISO),
        color: typeColor(n.folder),
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

    // Projects form their own constellation on the right: a clustering force
    // pulls them toward a shared centroid. Positioning only — no fake edges,
    // the brain's link semantics (and orphan detection) stay honest.
    const isProject = (d: SimNode) => d.path.startsWith("projects/");

    st.sim?.stop();
    st.sim = forceSimulation<SimNode>(st.nodes)
      // Links to the center sit on a wider orbit; everything else keeps its short reach.
      .force("link", forceLink<SimNode, any>(st.links).id((d: SimNode) => d.path)
        .distance((l: any) => (l.source.center || l.target.center ? 155 : 64)).strength(0.45))
      // The center repels much harder, carving out the space around itself.
      .force("charge", forceManyBody<SimNode>().strength((d) => (d.center ? -900 : -220)).distanceMax(520))
      // Slightly softer recentering so it doesn't fight the pinned center.
      .force("center", forceCenter(w / 2, h / 2).strength(0.7))
      // A wide collision moat around the center = a ring of empty space.
      .force("collide", forceCollide<SimNode>((d) => (d.center ? d.r + 68 : d.r + 5)))
      .force("x", forceX<SimNode>((d) => (d.center ? w / 2 : isProject(d) ? w * 0.8 : w * 0.4)).strength((d) => (d.center ? 0 : isProject(d) ? 0.11 : 0.05)))
      .force("y", forceY<SimNode>((d) => h / 2).strength((d) => (d.center ? 0 : 0.06)))
      .on("tick", draw);

    return () => { st.sim?.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

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

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const st = stateRef.current;
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

    // edges
    for (const l of st.links) {
      const s = l.source as SimNode, t = l.target as SimNode;
      if (s.x == null || t.x == null) continue;
      if (visible && !(visible.has(s.path) && visible.has(t.path))) continue;
      const on = hover && (s === hover || t === hover);
      const dimmed = (hover && !on) || (searching && !(s.match && t.match));
      ctx.strokeStyle = on ? ACCENT : dimmed ? "rgba(17,17,17,.05)" : "rgba(17,17,17,.16)";
      ctx.lineWidth = 1 / st.k;
      ctx.beginPath();
      ctx.moveTo(s.x!, s.y!);
      ctx.lineTo(t.x!, t.y!);
      ctx.stroke();
    }

    // labels fade in with zoom; hover always shows its neighborhood.
    const zoomAlpha = smoothstep(1.15, 2.0, st.k);

    const { contentHits } = propsRef.current;

    // Labels are collected here and drawn in a second pass, AFTER every node,
    // so text always sits on top of the graph instead of being overpainted by
    // whatever node happens to render later.
    const labels: { n: SimNode; alpha: number; strong: boolean; dimmed: boolean }[] = [];

    for (const n of st.nodes) {
      if (n.x == null) continue;
      if (visible && !visible.has(n.path)) continue;
      const isHover = n === hover;
      const isNeigh = neigh.has(n);
      // Search tiers: title/path match = full ink; body-only match = half ink.
      const secondary = searching && !n.match && contentHits.has(n.path);
      const dimmed = (hover && !isHover && !isNeigh) || (searching && !n.match && !secondary);

      ctx.beginPath();
      ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2);
      if (n.stale) {
        ctx.setLineDash([3 / st.k, 3 / st.k]);
        ctx.strokeStyle = dimmed ? RULE : n.color;
        ctx.globalAlpha = isHover || dimmed ? 1 : secondary ? 0.4 : 0.75;
        ctx.lineWidth = 1.3 / st.k;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
      } else {
        // Hover keeps the node's own color; a light red ring marks it
        // instead of flooding it red.
        ctx.fillStyle = dimmed ? RULE : n.color;
        ctx.globalAlpha = isHover || dimmed ? 1 : secondary ? 0.4 : FRESH_ALPHA[n.fresh];
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (isHover) {
        // Ring hugs the node (no moat): its inner edge sits at the node rim, so
        // the red edges terminate cleanly at the outline instead of appearing to
        // pierce a gap into the node. Stroke ~1.8px wide, centered at r+0.6.
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, n.r + 0.6 / st.k, 0, Math.PI * 2);
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 1.8 / st.k;
        ctx.stroke();
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

    // Second pass: labels on top. Centered UNDER the node and
    // lifted off the graph by a light halo so the text stays readable even where
    // it crosses other nodes or edges.
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const { n, alpha, dimmed } of labels) {
      ctx.globalAlpha = alpha;
      ctx.font = `600 ${11 / st.k}px Archivo, Arial, sans-serif`;
      const x = n.x!;
      const y = n.y! + n.r + 5 / st.k;
      ctx.lineJoin = "round";
      ctx.lineWidth = 3 / st.k;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
      ctx.strokeText(n.label, x, y);
      ctx.fillStyle = dimmed ? RULE : INK;
      ctx.fillText(n.label, x, y);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

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
    const ro = new ResizeObserver(() => draw());

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
