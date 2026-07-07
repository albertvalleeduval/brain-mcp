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
export type NavName = "home" | "projets" | "echeances" | "inbox" | "decisions" | "journal" | "health";

export type Route = { name: NavName } | { name: "file"; path: string };

/** One source of truth for nav-name ↔ URL, used by both parseRoute and the sidebar. */
export const NAV_PATH: Record<NavName, string> = {
  home: "/",
  projets: "/projets",
  echeances: "/echeances",
  inbox: "/inbox",
  decisions: "/decisions",
  journal: "/journal",
  health: "/health",
};

export function parseRoute(pathname: string): Route {
  const p = decodeURIComponent(pathname);
  if (p.startsWith("/fichier/")) return { name: "file", path: p.slice("/fichier/".length) };
  const hit = (Object.keys(NAV_PATH) as NavName[]).find((n) => NAV_PATH[n] === p);
  return { name: hit ?? "home" };
}

export const fileUrl = (path: string) => `/fichier/${path.split("/").map(encodeURIComponent).join("/")}`;
