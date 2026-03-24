/**
 * Spend tracking utilities.
 * IST day boundary: 4:00 AM IST (22:30 UTC previous day).
 */

/**
 * Get the current "spend date" in IST with 4 AM boundary.
 * If it's before 4 AM IST, we consider it still the previous day.
 * Returns YYYY-MM-DD string.
 */
export function getISTSpendDate(now?: Date): string {
  const d = now || new Date();
  // IST is UTC+5:30
  const istMs = d.getTime() + (5.5 * 60 * 60 * 1000);
  const ist = new Date(istMs);

  // If before 4 AM IST, it's still "yesterday"
  if (ist.getUTCHours() < 4) {
    ist.setUTCDate(ist.getUTCDate() - 1);
  }

  const year = ist.getUTCFullYear();
  const month = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const day = String(ist.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get the start of the current IST "spend day" (4 AM IST) as a UTC Date.
 */
export function getISTDayStart(now?: Date): Date {
  const spendDate = getISTSpendDate(now);
  // 4 AM IST = 22:30 UTC of previous day
  // spendDate is the IST date, so 4 AM IST on spendDate = spendDate + "T04:00:00+05:30"
  // In UTC: spendDate - 1 day + 22:30
  const [y, m, d] = spendDate.split("-").map(Number);
  const utcStart = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  // Subtract 5.5 hours to convert 4 AM IST to UTC
  // 4:00 IST = 4:00 - 5:30 = -1:30 = previous day 22:30 UTC
  utcStart.setUTCHours(0, 0, 0, 0);
  // Actually: 4 AM IST on date D = D at 04:00 IST = D-1 at 22:30 UTC
  const dayStart = new Date(Date.UTC(y, m - 1, d - 1, 22, 30, 0));
  return dayStart;
}

/**
 * Get the start of IST week (Monday 4 AM IST) for the given date.
 */
export function getISTWeekStart(now?: Date): Date {
  const d = now || new Date();
  const spendDate = getISTSpendDate(d);
  const [y, m, day] = spendDate.split("-").map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, day));
  // getUTCDay: 0=Sun, 1=Mon, ...
  const dow = dateObj.getUTCDay();
  const mondayOffset = dow === 0 ? 6 : dow - 1;
  dateObj.setUTCDate(dateObj.getUTCDate() - mondayOffset);
  // Return Monday 4 AM IST = Monday-1 22:30 UTC
  return new Date(Date.UTC(
    dateObj.getUTCFullYear(),
    dateObj.getUTCMonth(),
    dateObj.getUTCDate() - 1,
    22, 30, 0
  ));
}
