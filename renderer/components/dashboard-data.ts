export type TrendDirection = "up" | "down";

export interface Metric {
  id: string;
  label: string;
  value: string;
  delta: string;
  trend: TrendDirection;
  series: number[];
}

export interface Activity {
  id: string;
  timestamp: string;
  event: string;
  source: string;
  value: string;
  status: "success" | "pending" | "failed";
}

export interface ChartPoint {
  label: string;
  value: number;
}

export type TimeRange = "24h" | "7d" | "30d";

export const sidebarViews = [
  { id: "overview", label: "Overview", icon: "LayoutDashboard" },
  { id: "revenue", label: "Revenue", icon: "TrendingUp" },
  { id: "users", label: "Users", icon: "Users" },
  { id: "engagement", label: "Engagement", icon: "Activity" },
  { id: "retention", label: "Retention", icon: "HeartPulse" },
] as const;

export type SidebarViewId = (typeof sidebarViews)[number]["id"];

const series24h = [42, 48, 55, 51, 63, 68, 72, 69, 75, 82, 78, 85];
const series7d = [320, 380, 350, 420, 460, 440, 510];
function scaleSeries(base: number[], target: number): number[] {
  const max = Math.max(...base);
  return base.map((v) => Math.round((v / max) * target));
}

export function getMetrics(range: TimeRange): Metric[] {
  const factor = range === "24h" ? 1 : range === "7d" ? 7 : 30;
  return [
    {
      id: "revenue",
      label: "Revenue",
      value: `$${(125.4 * factor).toFixed(1)}K`,
      delta: `+${(12 + (range === "30d" ? 3 : 0))}%`,
      trend: "up",
      series: scaleSeries(series24h, 100),
    },
    {
      id: "users",
      label: "Active Users",
      value: (8234 * factor).toLocaleString(),
      delta: `+${5 + (range === "7d" ? 2 : 0)}%`,
      trend: "up",
      series: scaleSeries(series7d, 100),
    },
    {
      id: "conversions",
      label: "Conversion Rate",
      value: `${(12.3 + (range === "30d" ? 0.8 : 0)).toFixed(1)}%`,
      delta: `-${2}%`,
      trend: "down",
      series: [60, 58, 62, 55, 57, 53, 50, 52, 48, 45, 47, 44],
    },
    {
      id: "retention",
      label: "Retention",
      value: `${(94.2 + (range === "30d" ? 0.5 : 0)).toFixed(1)}%`,
      delta: `+${3}%`,
      trend: "up",
      series: [80, 82, 85, 83, 87, 88, 90, 89, 91, 93, 92, 94],
    },
  ];
}

export function getChartData(range: TimeRange): ChartPoint[] {
  if (range === "24h") {
    return Array.from({ length: 12 }, (_, i) => ({
      label: `${i * 2}:00`,
      value: 40 + Math.round(Math.sin(i / 2) * 20 + i * 3),
    }));
  }
  if (range === "7d") {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return days.map((label, i) => ({
      label,
      value: 300 + Math.round(Math.cos(i / 2) * 80 + i * 30),
    }));
  }
  return Array.from({ length: 30 }, (_, i) => ({
    label: `Day ${i + 1}`,
    value: 1200 + Math.round(Math.sin(i / 3) * 300 + i * 60),
  }));
}

export function getActivities(range: TimeRange): Activity[] {
  const count = range === "24h" ? 6 : range === "7d" ? 8 : 10;
  const events = [
    { event: "New subscription", source: "Web", value: "$49.00", status: "success" },
    { event: "Payment processed", source: "Stripe", value: "$129.00", status: "success" },
    { event: "User signup", source: "iOS", value: "—", status: "success" },
    { event: "Trial started", source: "Web", value: "—", status: "pending" },
    { event: "Churn alert", source: "Analytics", value: "—", status: "failed" },
    { event: "Upgrade plan", source: "iOS", value: "$99.00", status: "success" },
    { event: "Refund issued", source: "Stripe", value: "-$29.00", status: "pending" },
    { event: "API key generated", source: "Web", value: "—", status: "success" },
    { event: "Export completed", source: "API", value: "2.4K rows", status: "success" },
    { event: "Webhook delivered", source: "API", value: "—", status: "success" },
  ] as const;

  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const entry = events[i % events.length];
    const minutesAgo = (i + 1) * (range === "24h" ? 17 : range === "7d" ? 180 : 720);
    const ts = new Date(now.getTime() - minutesAgo * 60000);
    return {
      id: `act-${i}`,
      timestamp:
        range === "24h"
          ? ts.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
          : ts.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      event: entry.event,
      source: entry.source,
      value: entry.value,
      status: entry.status,
    };
  });
}
