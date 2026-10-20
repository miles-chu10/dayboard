import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

/** The SDK scroll area's footer clips descendants, so composer menus live above it in a portal. */
export function ComposerPopup({
  anchorRef,
  popupRef,
  width,
  className,
  role,
  label,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  popupRef: RefObject<HTMLDivElement | null>;
  width?: number;
  className: string;
  role?: "dialog";
  label?: string;
  children: ReactNode;
}) {
  const [position, setPosition] = useState<CSSProperties>();
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const size = Math.min(width ?? rect.width, window.innerWidth - 16);
      setPosition({
        width: size,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - size - 8)),
        bottom: window.innerHeight - rect.top + 8,
        maxHeight: Math.max(0, rect.top - 16),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(anchor);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef, width]);

  return createPortal(
    <div
      ref={popupRef}
      role={role}
      aria-label={label}
      className={`fixed z-50 overflow-y-auto ${className}`}
      style={{ ...position, visibility: position ? undefined : "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}
