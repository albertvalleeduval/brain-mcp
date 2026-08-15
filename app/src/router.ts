/** Tiny History-API router. The Worker serves the SPA on any path (fallback),
 *  so real URLs like /health, /decisions, /fichier/<path> are deep-linkable. */

import { useEffect, useState } from "react";

export function navigate(to: string, replace = false): void {
  if (replace) window.history.replaceState({}, "", to);
  else window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useLocation(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return path;
}

/** The nav-able destinations: everything reachable from a sidebar tile. */
export type NavName = "home" | "projets" | "echeances" | "inbox" | "decisions" | "contradictions" | "journal" | "health";

/** `capture` is deliberately NOT a NavName: it's the phone's standalone capture
 *  surface, reached from the home-screen shortcut, and it renders without the
 *  sidebar and without waiting for the graph to load. */
export type Route = { name: NavName } | { name: "file"; path: string } | { name: "capture" };

/** One source of truth for nav-name ↔ URL, used by both parseRoute and the sidebar. */
export const NAV_PATH: Record<NavName, string> = {
  home: "/",
  projets: "/projets",
  echeances: "/echeances",
  inbox: "/inbox",
  decisions: "/decisions",
  contradictions: "/contradictions",
  journal: "/journal",
  health: "/health",
};

export function parseRoute(pathname: string): Route {
  let p: string;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    // Malformed %-escape (e.g. a bad deep link) — don't crash the whole app.
    return { name: "home" };
  }
  if (p === "/capture") return { name: "capture" };
  if (p.startsWith("/fichier/")) return { name: "file", path: p.slice("/fichier/".length) };
  const hit = (Object.keys(NAV_PATH) as NavName[]).find((n) => NAV_PATH[n] === p);
  return { name: hit ?? "home" };
}

export const fileUrl = (path: string) => `/fichier/${path.split("/").map(encodeURIComponent).join("/")}`;
