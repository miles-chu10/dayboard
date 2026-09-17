import { useState, useMemo, type ComponentType } from "react";
import {
  SplitView,
  Sidebar,
  SidebarList,
  SidebarListItem,
  SidebarListGroup,
  SidebarFooter,
  ScrollArea,
  SegmentedControl,
  SegmentedControlItem,
  Text,
} from "@glaze/core/components";
import {
  LayoutDashboard,
  TrendingUp,
  Users,
  Activity,
  HeartPulse,
  Settings,
} from "lucide-react";
import { MetricCard } from "../components/metric-card";
import { AreaChart } from "../components/area-chart";
import { ActivityTable } from "../components/activity-table";
import {
  getMetrics,
  getChartData,
  getActivities,
  sidebarViews,
  type TimeRange,
  type SidebarViewId,
} from "../components/dashboard-data";

const iconMap: Record<string, ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  TrendingUp,
  Users,
  Activity,
  HeartPulse,
};

const viewTitles: Record<SidebarViewId, string> = {
  overview: "Overview",
  revenue: "Revenue",
  users: "Users",
  engagement: "Engagement",
  retention: "Retention",
};

export function HomeView() {
  const [selectedView, setSelectedView] = useState<SidebarViewId>("overview");
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");

  const metrics = useMemo(() => getMetrics(timeRange), [timeRange]);
  const chartData = useMemo(() => getChartData(timeRange), [timeRange]);
  const activities = useMemo(() => getActivities(timeRange), [timeRange]);

  return (
    <SplitView
      storageKey="dashboard-layout"
      sidebar={
        <Sidebar
          footer={
            <SidebarFooter>
              <SidebarList>
                <SidebarListItem
                  icon={<Settings className="size-4" />}
                  title="Settings"
                  onClick={() => {
                    /* Settings opened via menu */
                  }}
                />
              </SidebarList>
            </SidebarFooter>
          }
        >
          <SidebarList>
            <SidebarListItem
              icon={(() => {
                const Icon = iconMap[sidebarViews[0].icon];
                return <Icon className="size-4" />;
              })()}
              title={sidebarViews[0].label}
              selected={selectedView === sidebarViews[0].id}
              onClick={() => setSelectedView(sidebarViews[0].id)}
            />
            <SidebarListGroup title="Analytics">
              {sidebarViews.slice(1).map((view) => {
                const Icon = iconMap[view.icon];
                return (
                  <SidebarListItem
                    key={view.id}
                    icon={<Icon className="size-4" />}
                    title={view.label}
                    selected={selectedView === view.id}
                    onClick={() => setSelectedView(view.id)}
                  />
                );
              })}
            </SidebarListGroup>
          </SidebarList>
        </Sidebar>
      }
    >
      <ScrollArea
        title={viewTitles[selectedView]}
        subtitle={`${metrics.length} metrics · ${activities.length} events`}
        actions={
          <SegmentedControl
            value={timeRange}
            onValueChange={(v) => setTimeRange(v as TimeRange)}
            aria-label="Time range"
            size="small"
          >
            <SegmentedControlItem value="24h">24h</SegmentedControlItem>
            <SegmentedControlItem value="7d">7d</SegmentedControlItem>
            <SegmentedControlItem value="30d">30d</SegmentedControlItem>
          </SegmentedControl>
        }
        className="h-full"
        scrollbars="both"
      >
        <div className="flex flex-col gap-6 p-6 min-w-0">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {metrics.map((metric) => (
              <MetricCard key={metric.id} metric={metric} />
            ))}
          </div>

          {/* Chart */}
          <div className="rounded-lg bg-well border border-separator p-6 flex flex-col gap-4 min-w-0">
            <div className="flex items-center justify-between">
              <Text variant="large-strong" as="h3">
                Performance Trend
              </Text>
              <Text variant="small" color="tertiary">
                {timeRange === "24h" ? "Hourly" : timeRange === "7d" ? "Daily" : "Daily"} data points
              </Text>
            </div>
            <AreaChart data={chartData} />
          </div>

          {/* Activity Table */}
          <div className="rounded-lg bg-well border border-separator p-6 flex flex-col gap-4 min-w-0">
            <Text variant="large-strong" as="h3">
              Recent Activity
            </Text>
            <ActivityTable activities={activities} />
          </div>
        </div>
      </ScrollArea>
    </SplitView>
  );
}
