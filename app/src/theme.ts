/**
 * Light/dark theme — three modes: auto | light | dark.
 *
 * "auto" follows daylight: dark between sunset and sunrise, computed for
 * your location (NOAA approximation, ~2 min accurate). The chosen mode lives
 * in localStorage; the data-theme attribute on <html> drives the CSS tokens
 * (see styles.css). An inline script in index.html applies the theme BEFORE
 * first paint (same formula) to avoid a flash.
 */

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
export type ThemeMode = "auto" | Theme;

const KEY = "theme-mode";
// EDIT ME: your latitude/longitude, used only for the sunset computation.
// Also update the copy of these two values in the inline script of
// app/index.html (it runs before this module loads). Default: Paris.
const LAT = 48.8566;
const LON = 2.3522;

export function getStoredMode(): ThemeMode {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "auto";
}

/** Lever/coucher du soleil en minutes UTC pour le jour de `now` (NOAA). */
function sunTimesUTC(now: Date): { rise: number; set: number } | null {
  const rad = Math.PI / 180;
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const doy = (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - start) / 86400000;
  const g = ((2 * Math.PI) / 365) * (doy - 1 + 0.5);
  const eqtime =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosHa = Math.cos(90.833 * rad) / (Math.cos(LAT * rad) * Math.cos(decl)) - Math.tan(LAT * rad) * Math.tan(decl);
  if (cosHa < -1 || cosHa > 1) return null; // jour/nuit polaire — pas à Paris
  const ha = Math.acos(cosHa) / rad;
  return { rise: 720 - 4 * (LON + ha) - eqtime, set: 720 - 4 * (LON - ha) - eqtime };
}

function isNight(now: Date): boolean {
  const t = sunTimesUTC(now);
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (!t) return mins < 7 * 60 || mins >= 19 * 60; // fallback improbable
  return mins < t.rise || mins >= t.set;
}

export function resolveMode(mode: ThemeMode, now = new Date()): Theme {
  if (mode !== "auto") return mode;
  return isNight(now) ? "dark" : "light";
}

function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#000000" : "#ffffff");
}

/** Mode + thème résolu, re-résolu chaque minute en auto (bascule au coucher). */
export function useThemeMode(): { mode: ThemeMode; theme: Theme; setMode: (m: ThemeMode) => void } {
  const [mode, setModeState] = useState<ThemeMode>(getStoredMode);
  const [theme, setTheme] = useState<Theme>(() => resolveMode(getStoredMode()));

  useEffect(() => {
    const apply = () => {
      const t = resolveMode(mode);
      setTheme(t);
      applyTheme(t);
    };
    apply();
    if (mode !== "auto") return;
    const id = window.setInterval(apply, 60_000);
    return () => window.clearInterval(id);
  }, [mode]);

  const setMode = (m: ThemeMode) => {
    localStorage.setItem(KEY, m);
    setModeState(m);
  };
  return { mode, theme, setMode };
}
