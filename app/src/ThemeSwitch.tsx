/** Segmented control de thème : clair | auto | sombre.
 *  Clic direct = manuel ; « auto » (défaut) suit le coucher du soleil (theme.ts).
 *  Langue de la DA : carré, filets 1px, segment actif ré-encré (--ghost),
 *  jamais de pilule. Utilisé en haut à droite du graphe et au pied de la
 *  sidebar. */

import type { Theme, ThemeMode } from "./theme";

const SEGMENTS: { mode: ThemeMode; label: string }[] = [
  { mode: "light", label: "clair" },
  { mode: "auto", label: "auto" },
  { mode: "dark", label: "sombre" },
];

export function ThemeSwitch({
  mode,
  resolved,
  onSet,
}: {
  mode: ThemeMode;
  /** Thème effectivement affiché — précise le title du segment auto. */
  resolved: Theme;
  onSet: (m: ThemeMode) => void;
}) {
  return (
    <div className="theme-switch" role="group" aria-label="Thème de l'interface">
      {SEGMENTS.map((s) => (
        <button
          key={s.mode}
          className={mode === s.mode ? "on" : ""}
          aria-pressed={mode === s.mode}
          title={
            s.mode === "auto"
              ? `Suit le coucher du soleil (en ce moment : ${resolved === "dark" ? "sombre" : "clair"})`
              : `Thème ${s.label} (manuel)`
          }
          onClick={() => onSet(s.mode)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
