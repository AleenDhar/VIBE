// Shared prompt-template helpers.
// =============================================================================
// Lives outside the "use server" file so client components (e.g. the CSV
// upload dialog) can import the constants and pure functions without Next.js
// rejecting non-async exports from a server-action module.
// =============================================================================

// Hard cap on CSV uploads so a stray 50k-row file can't lock up the runner
// queue or the UI table. Surfaced to the user with a clear error.
export const CSV_UPLOAD_MAX_ROWS = 500;

// Match {{name}} where name = letters / digits / underscore / dot / dash.
// Captures the inner name without the braces.
const TEMPLATE_PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

// All distinct placeholder names found in a template, in order of first
// appearance.
export function extractPlaceholders(template: string | null | undefined): string[] {
    if (!template) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of template.matchAll(TEMPLATE_PLACEHOLDER_RE)) {
        const name = m[1];
        if (!seen.has(name)) {
            seen.add(name);
            out.push(name);
        }
    }
    return out;
}

// Render template + structured block. The structured block is appended so a
// phase prompt can grep field names reliably even if the natural-language
// template paraphrases them.
export function renderPromptWithBlock(
    template: string,
    placeholders: string[],
    values: Record<string, string>
): string {
    const rendered = template.replace(TEMPLATE_PLACEHOLDER_RE, (_, name: string) => {
        const v = values[name];
        return v == null ? "" : String(v);
    });
    if (placeholders.length === 0) return rendered;
    const lines = placeholders.map((p) => {
        const v = values[p];
        // Humanize key for the block label: account_id -> Account ID.
        const label = p
            .split(/[_\-.]/)
            .filter(Boolean)
            .map((part) => (/^[a-z]+$/.test(part) ? part[0].toUpperCase() + part.slice(1) : part))
            .join(" ");
        return `${label}: ${v ?? ""}`;
    });
    return `${rendered}\n\n---\n${lines.join("\n")}`;
}
