/** Categorical print palette: node color = file type (folder). design/tokens.json → color.types */

export const TYPE_COLORS: Record<string, string> = {
  root: "#111111",
  context: "#ef7d00",
  people: "#2b4ee8",
  projects: "#17a34a",
  personal: "#d62d84",
  decisions: "#b38600",
  domains: "#0d9c8b",
  inbox: "#8a8a8a",
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
};

export function typeColor(folder: string): string {
  return TYPE_COLORS[folder] ?? TYPE_COLORS.root;
}
