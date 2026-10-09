import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "heading1",
        "heading2",
        "extra-large",
        "large",
        "regular",
        "small",
        "mini",
        "mono",
        "small-mono",
      ],
    },
  },
});

/** Merges conditional class names and resolves conflicting Tailwind utility classes. */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
