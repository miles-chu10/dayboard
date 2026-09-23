import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";

import { cn } from "./utils";
import { Button } from "./button";

export type MarkdownComponents = Components;

export interface MarkdownProps {
  children: string;
  isStreaming?: boolean;
  syntaxHighlighting?: boolean;
  onCopyCode?: (code: string) => void | Promise<void>;
  components?: MarkdownComponents;
  className?: string;
}

/** Closes an unterminated fenced code block or emphasis run at the end of a streaming chunk. */
function repairIncompleteMarkdown(source: string): string {
  const fenceMatches = source.match(/```/g);
  let repaired = source;
  if (fenceMatches && fenceMatches.length % 2 === 1) repaired += "\n```";
  for (const marker of ["**", "__", "`"]) {
    const count = repaired.split(marker).length - 1;
    if (count % 2 === 1) repaired += marker;
  }
  return repaired;
}

function CodeBlock({
  inline,
  className,
  children,
  onCopyCode,
}: {
  inline?: boolean;
  className?: string;
  children: React.ReactNode;
  onCopyCode?: (code: string) => void | Promise<void>;
}) {
  const [copied, setCopied] = React.useState(false);
  const code = String(children).replace(/\n$/, "");
  const language = /language-(\w+)/.exec(className ?? "")?.[1];

  if (inline) {
    return (
      <code className="rounded bg-control px-1 py-0.5 font-mono text-[0.9em] text-primary">
        {children}
      </code>
    );
  }

  return (
    <div className="group relative my-2 overflow-hidden rounded-lg border border-separator bg-well">
      <div className="flex items-center justify-between border-b border-separator px-3 py-1.5">
        <span className="text-small text-tertiary">{language ?? "text"}</span>
        {onCopyCode ? (
          <Button
            iconOnly
            size="small"
            variant="transparent"
            aria-label="Copy code"
            onClick={async () => {
              await onCopyCode(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check className="text-support-green" /> : <Copy />}
          </Button>
        ) : null}
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-small leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function Markdown({
  children,
  isStreaming,
  onCopyCode,
  components,
  className,
}: MarkdownProps) {
  const source = React.useMemo(
    () => (isStreaming ? repairIncompleteMarkdown(children) : children),
    [children, isStreaming],
  );

  return (
    <div
      className={cn(
        "space-y-2 text-regular text-primary [&_a]:text-link [&_a]:underline",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children: preChildren }) => <>{preChildren}</>,
          code: ({ node: _node, className: codeClassName, children: codeChildren }) => (
            <CodeBlock inline={!codeClassName} className={codeClassName} onCopyCode={onCopyCode}>
              {codeChildren}
            </CodeBlock>
          ),
          a: ({ node: _node, ...props }) => <a target="_blank" rel="noreferrer" {...props} />,
          ul: ({ node: _node, ...props }) => <ul className="list-disc pl-5" {...props} />,
          ol: ({ node: _node, ...props }) => <ol className="list-decimal pl-5" {...props} />,
          h1: ({ node: _node, ...props }) => (
            <h1 className="text-heading1 font-semibold" {...props} />
          ),
          h2: ({ node: _node, ...props }) => (
            <h2 className="text-heading2 font-semibold" {...props} />
          ),
          blockquote: ({ node: _node, ...props }) => (
            <blockquote className="border-l-2 border-separator pl-3 text-secondary" {...props} />
          ),
          ...components,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
