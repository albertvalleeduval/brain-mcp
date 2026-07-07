/**
 * Parse now.md by convention (brain-protocol): a "## Focus courant" bullet
 * list and a "## Deadlines proches" bullet list ("- **10 juillet** : texte").
 * Lenient by design — anything unparseable is shown raw, never dropped.
 */

export interface Deadline {
  day: string; // "10"
  month: string; // "JUL"
  text: string;
  daysLeft: number | null;
}

const FR_MONTHS: Record<string, number> = {
  janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11,
  décembre: 12, decembre: 12,
};
const MONTH_ABBR = ["JAN", "FÉV", "MAR", "AVR", "MAI", "JUN", "JUL", "AOÛ", "SEP", "OCT", "NOV", "DÉC"];

function section(body: string, title: string): string {
  const re = new RegExp(`^##\\s+${title}\\s*$([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, "mi");
  const m = body.match(re);
  return m ? m[1] : "";
}

function bullets(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => /^\s*-\s+/.test(l))
    .map((l) => l.replace(/^\s*-\s+/, "").trim());
}

/** Strip markdown decoration for sidebar display: **bold**, [[wiki]], (parens kept). */
export function plain(md: string): string {
  return md
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseFocus(body: string): string[] {
  return bullets(section(body, "Focus courant")).map(plain);
}

export function parseDeadlines(body: string, todayISO: string): Deadline[] {
  const today = new Date(`${todayISO}T00:00:00Z`);
  const year = today.getUTCFullYear();

  return bullets(section(body, "Deadlines proches")).map((b) => {
    const text = plain(b);
    const m = text.match(/^(\d{1,2})(?:\s*(?:au|→|-)\s*\d{1,2})?\s+([a-zéèûôî]+)\s*:?\s*(.*)$/i);
    const named = text.match(/^([a-zéèûôî]+)\s*:?\s*(.*)$/i);

    if (m && FR_MONTHS[m[2].toLowerCase()]) {
      const day = Number(m[1]);
      const month = FR_MONTHS[m[2].toLowerCase()];
      let due = new Date(Date.UTC(year, month - 1, day));
      if (due.getTime() < today.getTime() - 180 * 86400000) {
        due = new Date(Date.UTC(year + 1, month - 1, day));
      }
      return {
        day: String(day).padStart(2, "0"),
        month: MONTH_ABBR[month - 1],
        text: m[3] || text,
        daysLeft: Math.round((due.getTime() - today.getTime()) / 86400000),
      };
    }
    // "Septembre : bascule full-time" — month-only deadline.
    if (named && FR_MONTHS[named[1].toLowerCase()]) {
      const month = FR_MONTHS[named[1].toLowerCase()];
      let due = new Date(Date.UTC(year, month - 1, 1));
      if (due.getTime() < today.getTime() - 180 * 86400000) {
        due = new Date(Date.UTC(year + 1, month - 1, 1));
      }
      return {
        day: "01",
        month: MONTH_ABBR[month - 1],
        text: named[2] || text,
        daysLeft: Math.round((due.getTime() - today.getTime()) / 86400000),
      };
    }
    return { day: "·", month: "", text, daysLeft: null };
  });
}
