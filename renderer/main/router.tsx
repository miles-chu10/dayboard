import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { HomeView } from "./home-view";
import { AgendaView } from "./agenda-view";
import { TasksView } from "./tasks-view";
import { RemindersView } from "./reminders-view";
import { MailView } from "./mail-view";
import { CalendarView } from "./calendar-view";
import { AssistantView } from "./assistant-view";
import { ReviewView } from "./review-view";
import { NotesView } from "./notes-view";
import { RootView } from "./root-view";
import { QueryClient } from "@tanstack/react-query";
import { ErrorBoundaryView } from "@renderer/ui";
import type { ComponentType } from "react";
import { validateAgendaSearch } from "../lib/agenda-search";

const rootRoute = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: RootView,
  errorComponent: ErrorBoundaryView,
  notFoundComponent: () => {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <div className="drag-region fixed top-0 left-0 right-0 h-13" />
        <p className="text-secondary">Route not found</p>
      </div>
    );
  },
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomeView,
  staticData: { title: "Home" },
});

const agendaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agenda",
  component: AgendaView,
  validateSearch: validateAgendaSearch,
  staticData: { title: "Agenda" },
});

const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks",
  component: TasksView,
  staticData: { title: "Google Tasks" },
});

const remindersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reminders",
  component: RemindersView,
  staticData: { title: "Apple Reminders" },
});

const mailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mail",
  component: MailView,
  // `item` opens one message (from ⌘K or Home); the view keeps its own selection after that.
  validateSearch: (search: Record<string, unknown>): { item?: string } => ({
    item: typeof search.item === "string" && search.item ? search.item : undefined,
  }),
  staticData: { title: "Gmail" },
});

const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/calendar",
  component: CalendarView,
  validateSearch: validateAgendaSearch,
  staticData: { title: "Calendar" },
});

const assistantRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/assistant",
  component: AssistantView,
  // `prompt` hands a question over from Today's composer; the Assistant sends it once and clears it.
  validateSearch: (search: Record<string, unknown>): { prompt?: string } => ({
    prompt: typeof search.prompt === "string" && search.prompt.trim() ? search.prompt : undefined,
  }),
  staticData: { title: "Assistant" },
});

const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review",
  component: ReviewView,
  staticData: { title: "Weekly Review" },
});

const notesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notes",
  component: NotesView,
  // `note` opens one note (from ⌘K or "Save chat as note").
  validateSearch: (search: Record<string, unknown>): { note?: string } => ({
    note: typeof search.note === "string" && search.note ? search.note : undefined,
  }),
  staticData: { title: "Notes" },
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  agendaRoute,
  tasksRoute,
  remindersRoute,
  mailRoute,
  calendarRoute,
  notesRoute,
  assistantRoute,
  reviewRoute,
]);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 60_000,
    },
  },
});

const router = createRouter({
  routeTree,
  history: createMemoryHistory(),
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  context: {
    queryClient,
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
  interface StaticDataRouteOption {
    title?: string;
    component?: ComponentType;
  }
}

export { router, queryClient };
