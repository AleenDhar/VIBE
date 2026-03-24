"use client";

import { useEffect, useState } from "react";
import { formatModelName, formatTokenCount, formatCost } from "@/lib/usage-utils";

interface UsageData {
  model: string;
  total_tokens: number;
  cost_usd: number;
}

interface UsagePillProps {
  chatId: string;
  visible: boolean;
}

export function UsagePill({ chatId, visible }: UsagePillProps) {
  const [usage, setUsage] = useState<UsageData | null>(null);

  useEffect(() => {
    if (!visible || !chatId) {
      setUsage(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/usage/${chatId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data?.usage) {
          setUsage({
            model: data.usage.model,
            total_tokens: data.usage.total_tokens,
            cost_usd: data.usage.cost_usd,
          });
        }
      } catch (err) {
        console.error("[UsagePill] Failed to fetch usage:", err);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [visible, chatId]);

  if (!visible || !usage) return null;

  return (
    <div className="flex justify-center py-1">
      <div className="inline-flex items-center gap-2 text-xs text-muted-foreground bg-muted/60 rounded-full px-3 py-1">
        <span>{formatModelName(usage.model)}</span>
        <span className="opacity-40">|</span>
        <span>{formatTokenCount(usage.total_tokens)} tokens</span>
        <span className="opacity-40">|</span>
        <span>{formatCost(usage.cost_usd)}</span>
      </div>
    </div>
  );
}
