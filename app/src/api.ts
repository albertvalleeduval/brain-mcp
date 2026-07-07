/** Thin client over the Worker's /api routes. A 401 anywhere means: no session. */

import type { BrainGraph, HealthReport, Commit, ReplayFrame } from "./types";

export class Unauthorized extends Error {}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (res.status === 401) throw new Unauthorized();
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}

export const fetchGraph = () => get<BrainGraph>("/api/graph");
export const fetchHealth = () => get<HealthReport>("/api/health");
export const fetchHistory = () => get<Commit[]>("/api/history");
export const fetchReplay = () => get<{ frames: ReplayFrame[] }>("/api/replay");
export const fetchSearch = (q: string) =>
  get<{ paths: string[] }>('/api/search?q=' + encodeURIComponent(q));

export async function fetchFile(path: string): Promise<{ path: string; content: string }> {
  return get(`/api/file?path=${encodeURIComponent(path)}`);
}

async function send<T>(url: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Unauthorized();
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${url} → ${res.status}`);
  return data;
}

export async function uploadToInbox(filename: string, content: string): Promise<{ staged: string }> {
  return send("/api/inbox", "POST", { filename, content });
}

/** Create or update a markdown file (server enforces the brain's guards). */
export const saveFile = (path: string, content: string) =>
  send<{ path: string; created: boolean }>("/api/file", "PUT", { path, content });

/** Replace now.md's body (+ optional summaries). */
export const saveNow = (content: string, summary_l0?: string, summary_l1?: string) =>
  send<{ path: string }>("/api/now", "POST", { content, summary_l0, summary_l1 });

/** Append a dated decision entry. */
export const appendDecision = (text: string) =>
  send<{ path: string }>("/api/decision", "POST", { text });

/** Delete a processed inbox item. */
export const deleteInbox = (filename: string) =>
  send<{ deleted: string }>("/api/inbox/delete", "POST", { filename });
