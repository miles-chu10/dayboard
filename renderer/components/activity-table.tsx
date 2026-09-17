import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
  Text,
} from "@glaze/core/components";
import type { Activity } from "./dashboard-data";

const statusColor: Record<Activity["status"], "green" | "yellow" | "red"> = {
  success: "green",
  pending: "yellow",
  failed: "red",
};

const statusLabel: Record<Activity["status"], string> = {
  success: "Success",
  pending: "Pending",
  failed: "Failed",
};

export function ActivityTable({ activities }: { activities: Activity[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead>Event</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Value</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {activities.map((activity) => (
          <TableRow key={activity.id}>
            <TableCell>
              <Text variant="small" color="secondary" className="tabular-nums">
                {activity.timestamp}
              </Text>
            </TableCell>
            <TableCell>
              <Text variant="regular">{activity.event}</Text>
            </TableCell>
            <TableCell>
              <Text variant="small" color="tertiary">
                {activity.source}
              </Text>
            </TableCell>
            <TableCell>
              <Text variant="small" color="secondary" className="tabular-nums">
                {activity.value}
              </Text>
            </TableCell>
            <TableCell>
              <Badge color={statusColor[activity.status]}>
                {statusLabel[activity.status]}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
