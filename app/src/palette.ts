/** Peaux du graphe — une mécanique (Q Branch), deux styles.
 *
 *  Sombre : écran d'analyse Skyfall — points gris uniformes sur noir, la
 *  fraîcheur vit dans la valeur de gris, l'interaction ré-encre en blanc.
 *  Clair : palette catégorielle print (TYPE_COLORS ci-dessous) —
 *  couleur = type (dossier), taille ∝ degré, rouge suisse pour l'interaction.
 */

export type GraphTheme = "light" | "dark";

/** Palette catégorielle print (thème clair) : couleur du nœud = dossier. */
export const TYPE_COLORS: Record<string, string> = {
  root: "#111111",
  context: "#ef7d00",
  people: "#2b4ee8",
  projects: "#17a34a",
  personal: "#d62d84",
  decisions: "#b38600",
  domains: "#0d9c8b",
  inbox: "#8a8a8a",
  tensions: "#7c3aed",
  sources: "#64748b",
};

export const TYPE_LABELS: Record<string, string> = {
  root: "core",
  context: "contexte",
  people: "personnes",
  projects: "projets",
  personal: "perso",
  decisions: "décisions",
  domains: "domaines",
  inbox: "inbox",
  tensions: "contradictions",
  sources: "sources",
};

export function typeColor(folder: string): string {
  return TYPE_COLORS[folder] ?? TYPE_COLORS.root;
}

export interface GraphSkin {
  /** Fond du canvas en CSS — sert aussi de disque sous les nœuds périmés. */
  paperCss: string;
  ink: string;
  /** Ré-encrage interaction : blanc en sombre, rouge suisse en clair. */
  accent: string;
  /** Éléments éteints (hover ailleurs / hors recherche) : fondus dans le fond. */
  dim: string;
  label: string;
  edge: string;
  edgeDim: string;
  edgeOn: string;
  /** Halo des labels : les décolle du fond, couleur du papier. */
  labelHalo: string;
  /** Halo pulsant du nœud central. */
  centerHalo: string;
  /** Fraîcheur OPAQUE : pré-mélange la couleur vers le papier (facteur f).
   *  Un disque opaque masque réellement les arêtes qui passent derrière. */
  mix(hex: string, f: number): string;
  nodeColor(folder: string, center: boolean): string;
  radius(deg: number, center: boolean): number;
}

function mixTo(paper: [number, number, number]) {
  return (hex: string, f: number): string => {
    const c = (i: number) => Math.round(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) * f + paper[i] * (1 - f));
    return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
  };
}

export const GRAPH_SKINS: Record<GraphTheme, GraphSkin> = {
  dark: {
    paperCss: "#000000",
    ink: "#e6e6e6",
    accent: "#ffffff",
    dim: "#1c1c1c",
    label: "#a3a3a3",
    edge: "rgba(255, 255, 255, 0.28)",
    edgeDim: "rgba(255, 255, 255, 0.07)",
    edgeOn: "rgba(255, 255, 255, 0.6)",
    labelHalo: "rgba(0, 0, 0, 0.92)",
    centerHalo: "rgba(255, 255, 255, 0.9)",
    mix: mixTo([0, 0, 0]),
    // Monochrome : gris clair uniforme, le centre « me » reste blanc pur.
    nodeColor: (_folder, center) => (center ? "#ffffff" : "#b5b5b5"),
    // Uniforme : la taille n'encode rien, le degré pilote seulement les labels.
    radius: () => 3,
  },
  light: {
    paperCss: "#ffffff",
    ink: "#111111",
    accent: "#e2231a",
    dim: "#e3e3e3",
    label: "#6f6f6f",
    edge: "rgba(17, 17, 17, 0.25)",
    edgeDim: "rgba(17, 17, 17, 0.06)",
    edgeOn: "rgba(226, 35, 26, 0.65)",
    labelHalo: "rgba(255, 255, 255, 0.92)",
    centerHalo: "rgba(17, 17, 17, 0.35)",
    mix: mixTo([255, 255, 255]),
    nodeColor: (folder, center) => (center ? "#111111" : typeColor(folder)),
    // Print : taille ∝ degré, le centre domine. Base et pente resserrées
    // pour que les disques ne mangent pas le graphe.
    radius: (deg, center) => 2.4 + Math.sqrt(deg) * 1.3 + (center ? 3.5 : 0),
  },
};
