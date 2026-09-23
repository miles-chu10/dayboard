import { EmptyState } from "./empty-state";

export interface ErrorBoundaryViewProps {
  error: unknown;
}

export function ErrorBoundaryView({ error }: ErrorBoundaryViewProps) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return (
    <EmptyState
      placement="viewport"
      title="Something went wrong"
      description={
        <span className="whitespace-pre-wrap break-words font-mono text-small">{message}</span>
      }
    />
  );
}
