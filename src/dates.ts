/** Date helpers — always the owner's timezone (TIMEZONE var), so entries land on the right day. */

import { cfg } from "./config";

export function todayLocal(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: cfg().timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function currentMonthLocal(): string {
  return todayLocal().slice(0, 7); // YYYY-MM
}

/** HH:MM (owner timezone) — a clock reading, for text meant to be read. */
export function clockLocal(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: cfg().timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

/** HHmm (owner timezone) — used to stamp capture FILENAMES, hence no colon.
 *  For a timestamp inside a file's text, use clockLocal(). */
export function timeLocal(): string {
  return clockLocal().replace(":", "");
}
