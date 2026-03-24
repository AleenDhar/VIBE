/**
 * Strips provider prefix and humanizes model name.
 * "anthropic:claude-sonnet-4-20250514" → "Claude Sonnet 4"
 * "openai:gpt-4o" → "GPT 4o"
 */
export function formatModelName(model: string): string {
  // Strip provider prefix
  const name = model.includes(":") ? model.split(":").slice(1).join(":") : model;

  // Remove date suffix (e.g. -20250514)
  const withoutDate = name.replace(/-\d{8}$/, "");

  // Humanize: split on hyphens, capitalize appropriately
  const parts = withoutDate.split("-").filter(Boolean);

  return parts
    .map((part) => {
      const lower = part.toLowerCase();
      // Known brand words
      if (lower === "claude") return "Claude";
      if (lower === "gpt") return "GPT";
      if (lower === "grok") return "Grok";
      if (lower === "gemini") return "Gemini";
      if (lower === "deepseek") return "DeepSeek";
      // Version-like parts (e.g. "4o", "3.5") stay as-is
      if (/^\d/.test(part)) return part;
      // Capitalize first letter
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

/**
 * Format token count with comma-separated thousands.
 * 15600 → "15,600"
 */
export function formatTokenCount(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Format USD cost with at least 4 decimal places.
 * 0.0852 → "$0.0852"
 * 4.8216 → "$4.8216"
 */
export function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}
