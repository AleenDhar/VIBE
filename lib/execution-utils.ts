/**
 * Utility functions for the admin executions dashboard.
 */

export function formatDuration(
  startedAt: string | null,
  completedAt: string | null
): string {
  if (!startedAt) return "--";
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const diffMs = end - start;

  if (diffMs < 1000) return "<1s";
  if (diffMs < 60_000) return `${Math.round(diffMs / 1000)}s`;
  if (diffMs < 3_600_000) {
    const min = Math.floor(diffMs / 60_000);
    const sec = Math.round((diffMs % 60_000) / 1000);
    return `${min}m ${sec}s`;
  }
  const hr = Math.floor(diffMs / 3_600_000);
  const min = Math.round((diffMs % 3_600_000) / 60_000);
  return `${hr}h ${min}m`;
}

export function getStatusColor(status: string): string {
  switch (status) {
    case "running":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-500/30";
    case "completed":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30";
    case "failed":
      return "bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/30";
    case "pending":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30";
    case "stopped":
      return "bg-gray-500/15 text-gray-700 dark:text-gray-400 border border-gray-500/30";
    default:
      return "bg-gray-500/15 text-gray-700 dark:text-gray-400 border border-gray-500/30";
  }
}

export function getExecutionTypeConfig(type: string): {
  label: string;
  color: string;
} {
  switch (type) {
    case "chat":
      return {
        label: "Chat",
        color:
          "bg-violet-500/15 text-violet-700 dark:text-violet-400 border border-violet-500/30",
      };
    case "automation":
      return {
        label: "Automation",
        color:
          "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border border-cyan-500/30",
      };
    case "workflow":
      return {
        label: "Workflow",
        color:
          "bg-orange-500/15 text-orange-700 dark:text-orange-400 border border-orange-500/30",
      };
    default:
      return {
        label: type,
        color:
          "bg-gray-500/15 text-gray-700 dark:text-gray-400 border border-gray-500/30",
      };
  }
}
