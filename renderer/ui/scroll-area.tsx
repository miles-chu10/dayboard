import * as React from "react";
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";
import { ChevronDown } from "lucide-react";

import { cn } from "./utils";
import {
  Toolbar,
  ToolbarActions,
  ToolbarContent,
  ToolbarRow,
  ToolbarTitle,
  ToolbarDescription,
} from "./toolbar";
import { Button } from "./button";

export interface ScrollAreaControl {
  forceScrollToBottom: () => void;
  suspendAutoFollow: () => void;
  resumeAutoFollow: () => void;
}

export interface ScrollAreaProps extends Omit<
  React.ComponentProps<typeof ScrollAreaPrimitive.Root>,
  "title"
> {
  toolbar?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  leading?: React.ReactNode;
  footer?: React.ReactNode;
  viewportClassName?: string;
  fadeEdges?: boolean;
  autoScrollToBottom?: boolean;
  autoScrollDeps?: React.DependencyList;
  showScrollToBottomButton?: boolean;
  scrollbars?: "vertical" | "horizontal" | "both";
  scrollbarBottomOffset?: number;
  scrollbarTopOffset?: number;
  scrollControlRef?: React.MutableRefObject<ScrollAreaControl | null>;
}

export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  (
    {
      children,
      toolbar,
      title,
      subtitle,
      actions,
      leading,
      footer,
      className,
      viewportClassName,
      fadeEdges,
      autoScrollToBottom,
      autoScrollDeps = [],
      showScrollToBottomButton,
      scrollbars = "vertical",
      scrollbarBottomOffset = 0,
      scrollbarTopOffset = 0,
      scrollControlRef,
      ...props
    },
    forwardedRef,
  ) => {
    const viewportRef = React.useRef<HTMLDivElement | null>(null);
    const followingRef = React.useRef(true);
    const suspendCountRef = React.useRef(0);
    const [atBottom, setAtBottom] = React.useState(true);

    const setViewportRef = React.useCallback(
      (node: HTMLDivElement | null) => {
        viewportRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef)
          (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      },
      [forwardedRef],
    );

    const scrollToBottom = React.useCallback((behavior: ScrollBehavior = "auto") => {
      const node = viewportRef.current;
      if (!node) return;
      node.scrollTo({ top: node.scrollHeight, behavior });
    }, []);

    React.useImperativeHandle(scrollControlRef, () => ({
      forceScrollToBottom: () => {
        followingRef.current = true;
        scrollToBottom();
      },
      suspendAutoFollow: () => {
        suspendCountRef.current += 1;
      },
      resumeAutoFollow: () => {
        suspendCountRef.current = Math.max(0, suspendCountRef.current - 1);
        if (suspendCountRef.current === 0) {
          const node = viewportRef.current;
          if (node)
            followingRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
        }
      },
    }));

    const handleScroll = React.useCallback(() => {
      const node = viewportRef.current;
      if (!node) return;
      const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
      setAtBottom(nearBottom);
      if (suspendCountRef.current === 0) followingRef.current = nearBottom;
    }, []);

    React.useEffect(() => {
      if (!autoScrollToBottom || !followingRef.current) return;
      scrollToBottom();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoScrollToBottom, children, ...autoScrollDeps]);

    const resolvedToolbar =
      toolbar ??
      (title || subtitle || actions || leading ? (
        <Toolbar>
          <ToolbarRow>
            {leading}
            {title || subtitle ? (
              <ToolbarContent>
                {title ? <ToolbarTitle>{title}</ToolbarTitle> : null}
                {subtitle ? <ToolbarDescription>{subtitle}</ToolbarDescription> : null}
              </ToolbarContent>
            ) : null}
            {actions ? <ToolbarActions>{actions}</ToolbarActions> : null}
          </ToolbarRow>
        </Toolbar>
      ) : null);

    return (
      <ScrollAreaPrimitive.Root
        className={cn("relative flex flex-col overflow-hidden", className)}
        {...props}
      >
        {resolvedToolbar}
        <div className="relative flex-1 min-h-0">
          <ScrollAreaPrimitive.Viewport
            ref={setViewportRef}
            onScroll={handleScroll}
            className={cn(
              "size-full",
              fadeEdges &&
                "[mask-image:linear-gradient(to_bottom,transparent,black_12px,black_calc(100%-12px),transparent)]",
              viewportClassName,
            )}
          >
            {children}
          </ScrollAreaPrimitive.Viewport>
          {scrollbars !== "horizontal" ? (
            <ScrollAreaPrimitive.Scrollbar
              orientation="vertical"
              className="flex w-2.5 touch-none select-none p-0.5 transition-[width] data-[state=hidden]:opacity-0"
              style={{
                marginTop: scrollbarTopOffset,
                marginBottom: scrollbarBottomOffset,
              }}
            >
              <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-quaternary" />
            </ScrollAreaPrimitive.Scrollbar>
          ) : null}
          {scrollbars !== "vertical" ? (
            <ScrollAreaPrimitive.Scrollbar
              orientation="horizontal"
              className="flex h-2.5 touch-none select-none p-0.5 transition-[height] data-[state=hidden]:opacity-0"
            >
              <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-quaternary" />
            </ScrollAreaPrimitive.Scrollbar>
          ) : null}
          {showScrollToBottomButton && !atBottom ? (
            <Button
              iconOnly
              size="small"
              variant="glass"
              aria-label="Scroll to bottom"
              onClick={() => {
                followingRef.current = true;
                scrollToBottom("smooth");
              }}
              className="absolute bottom-2 left-1/2 -translate-x-1/2 shadow-md"
            >
              <ChevronDown />
            </Button>
          ) : null}
        </div>
        {footer}
      </ScrollAreaPrimitive.Root>
    );
  },
);
ScrollArea.displayName = "ScrollArea";
