import { Text } from "@glaze/core/components";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import type { Metric } from "./dashboard-data";

export function MetricCard({ metric }: { metric: Metric }) {
  const isUp = metric.trend === "up";
  const trendColor = isUp ? "green" : "red";
  const TrendIcon = isUp ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="rounded-lg bg-well border border-separator p-4 flex flex-col gap-3 min-w-0">
      <div className="flex items-center justify-between">
        <Text variant="small" color="tertiary">
          {metric.label}
        </Text>
        <div className={`flex items-center gap-0.5 text-support-${trendColor}`}>
          <TrendIcon className="size-3 shrink-0" />
          <Text variant="mini-strong" color={trendColor}>
            {metric.delta}
          </Text>
        </div>
      </div>
      <Text variant="heading2" as="p" className="tabular-nums">
        {metric.value}
      </Text>
      <Sparkline data={metric.series} positive={isUp} />
    </div>
  );
}

function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  const w = 100;
  const h = 28;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const color = positive ? "rgb(var(--color-support-green-500))" : "rgb(var(--color-support-red-500))";

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-7" preserveAspectRatio="none">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
