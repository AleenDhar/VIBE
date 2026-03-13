/**
 * Simple cron expression matcher.
 * Supports standard 5-field cron: minute hour dayOfMonth month dayOfWeek
 * Supports: *, specific numbers, ranges (1-5), lists (1,3,5), step values (star/5)
 */

function matchField(field: string, value: number, max: number): boolean {
    if (field === "*") return true;

    // Handle step values: */5 or 1-10/2
    if (field.includes("/")) {
        const [range, stepStr] = field.split("/");
        const step = parseInt(stepStr, 10);
        if (isNaN(step) || step <= 0) return false;

        let start = 0;
        let end = max;

        if (range !== "*") {
            if (range.includes("-")) {
                const [s, e] = range.split("-").map(Number);
                start = s;
                end = e;
            } else {
                start = parseInt(range, 10);
                end = max;
            }
        }

        if (value < start || value > end) return false;
        return (value - start) % step === 0;
    }

    // Handle lists: 1,3,5
    if (field.includes(",")) {
        return field.split(",").some((part) => matchField(part.trim(), value, max));
    }

    // Handle ranges: 1-5
    if (field.includes("-")) {
        const [start, end] = field.split("-").map(Number);
        return value >= start && value <= end;
    }

    // Specific value
    return parseInt(field, 10) === value;
}

/**
 * Check if a cron expression matches the given date.
 */
export function cronMatchesNow(cronExpr: string, date: Date = new Date()): boolean {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) return false;

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    return (
        matchField(minute, date.getMinutes(), 59) &&
        matchField(hour, date.getHours(), 23) &&
        matchField(dayOfMonth, date.getDate(), 31) &&
        matchField(month, date.getMonth() + 1, 12) && // cron months are 1-12
        matchField(dayOfWeek, date.getDay(), 6) // 0=Sunday
    );
}

/**
 * Convert a cron expression to a human-readable string.
 */
export function cronToHuman(cronExpr: string): string {
    if (!cronExpr) return "";
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) return cronExpr;

    const [minute, hour, _dom, _month, dow] = parts;

    const timeStr = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;

    // Common patterns
    if (dow === "*" && _dom === "*" && _month === "*") {
        return `Daily at ${timeStr}`;
    }
    if (dow === "1-5" && _dom === "*" && _month === "*") {
        return `Weekdays at ${timeStr}`;
    }
    if (dow === "1" && _dom === "*" && _month === "*") {
        return `Every Monday at ${timeStr}`;
    }
    if (_dom === "1" && dow === "*" && _month === "*") {
        return `Monthly (1st) at ${timeStr}`;
    }

    // Interval patterns
    if (hour.startsWith("*/")) {
        return `Every ${hour.split("/")[1]} hours`;
    }
    if (minute.startsWith("*/")) {
        return `Every ${minute.split("/")[1]} minutes`;
    }

    return cronExpr;
}
