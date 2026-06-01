// The todos feature has been removed. The agent no longer emits `write_todos`
// output, but historical chats still contain rows shaped like:
//   1. "todos: 4 items (1 pending / 1 in_progress / 2 completed)" — summary
//   2. "Updated todo list to [{'content': '...', 'status': '...'}, ...]" — full list
//
// `isTodoMessage` is kept purely as a DETECTOR so the chat UI can suppress
// those legacy rows. No todo card is rendered anymore.

// Matches: "todos: 4 items (1 pending / 1 in_progress / 2 completed)"
const SUMMARY_RE = /^todos:\s*(\d+)\s*items?\s*\(\s*(\d+)\s*pending\s*\/\s*(\d+)\s*in_progress\s*\/\s*(\d+)\s*completed\s*\)/i;

// Matches: "Updated todo list to [...]" — value may use single or double quotes
const UPDATED_RE = /^Updated todo list to\s*(\[.*\])/i;

export function isTodoMessage(content: string): boolean {
    const trimmed = (content || "").trim();
    return SUMMARY_RE.test(trimmed) || UPDATED_RE.test(trimmed);
}
