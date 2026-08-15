/** Peaux du graphe — une mécanique, deux styles.
 *
 *  Sombre : points gris uniformes sur le fond de l'app, la fraîcheur vit dans
 *  la valeur de gris, l'interaction s'allume en bleu (--accent).
 *  Clair : palette catégorielle — couleur = type (dossier), taille ∝ degré,
 *  même bleu d'interaction.
 *
 *  Les valeurs suivent les tokens de app/src/styles.css : le canvas doit
 *  peindre exactement le --paper du thème, sinon le graphe flotte sur une
 *  plaque plus sombre que la pièce.
 */

export type GraphTheme = "light" | "dark";

/** Palette catégorielle print (thème clair) : couleur du nœud = dossier. */
export const TYPE_COLORS: Record<string, string> = {
  root: "#16161a",
  context: "#e07a1a",
  people: "#2f6bed",
  projects: "#16a34a",
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
    paperCss: "#08080a",
    ink: "#f1f1f3",
    accent: "#5b8dff",
    dim: "#1e1e22",
    label: "#8f8f99",
    edge: "rgba(255, 255, 255, 0.22)",
    edgeDim: "rgba(255, 255, 255, 0.06)",
    edgeOn: "rgba(91, 141, 255, 0.7)",
    labelHalo: "rgba(8, 8, 10, 0.92)",
    centerHalo: "rgba(91, 141, 255, 0.85)",
    mix: mixTo([8, 8, 10]),
    // Monochrome : gris clair uniforme, le centre « me » reste blanc pur.
    nodeColor: (_folder, center) => (center ? "#ffffff" : "#a8a8b2"),
    // Uniforme : la taille n'encode rien, le degré pilote seulement les labels.
    radius: () => 3,
  },
  light: {
    paperCss: "#f4f4f6",
    ink: "#16161a",
    accent: "#2f6bed",
    dim: "#dededf",
    label: "#6b6b76",
    edge: "rgba(22, 22, 26, 0.22)",
    edgeDim: "rgba(22, 22, 26, 0.06)",
    edgeOn: "rgba(47, 107, 237, 0.7)",
    labelHalo: "rgba(244, 244, 246, 0.92)",
    centerHalo: "rgba(47, 107, 237, 0.45)",
    mix: mixTo([244, 244, 246]),
    nodeColor: (folder, center) => (center ? "#16161a" : typeColor(folder)),
    // Print : taille ∝ degré, le centre domine. Base et pente resserrées
    // pour que les disques ne mangent pas le graphe.
    radius: (deg, center) => 2.4 + Math.sqrt(deg) * 1.3 + (center ? 3.5 : 0),
  },
};
