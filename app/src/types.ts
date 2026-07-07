/** Mirrors the Worker's src/graph.ts output shapes. */

export interface GraphNode {
  path: string;
  title: string;
  id: string | null;
  type: string | null;
  tags: string[];
  status: string | null;
  updated: string | null;
  summary_l0: string | null;
  folder: string;
  size: number;
  inDegree: number;
  outDegree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface BrokenLink {
  source: string;
  target: string;
}

export interface BrainGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  brokenLinks: BrokenLink[];
  /** Path of the central "me" node (Worker CENTER_PATH var); null = none. */
  centerPath?: string | null;
}

export interface StaleFile {
  path: string;
  updated: string;
  ageDays: number;
  ttlDays: number;
}

export interface HealthReport {
  generatedOn: string;
  files: number;
  score: number;
  brokenLinks: BrokenLink[];
  orphans: string[];
  stale: StaleFile[];
  missingSummaries: string[];
  inbox: string[];
}

export interface Commit {
  sha: string;
  message: string;
  date: string;
}

export interface ReplayFrame {
  sha: string;
  date: string;
  files: string[];
}
