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

/** HHmm (owner timezone) — used to stamp capture filenames. */
export function timeLocal(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: cfg().timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .replace(":", "");
}
