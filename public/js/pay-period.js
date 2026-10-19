// Use calendar days in UTC so daylight-saving changes cannot shift the cycle.
export function biweeklyStart(date) {
  const anchor = Date.UTC(2026, 9, 5);
  const day = Date.parse(`${date}T00:00:00Z`);
  return new Date(anchor + Math.floor((day - anchor) / (14 * 86400000)) * 14 * 86400000).toISOString().slice(0, 10);
}
