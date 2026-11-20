import type { ReactNode } from "react";
import { inlineText, type Align, type Block, type Inline } from "@/lib/team/markdown";

// Renders the block tree of lib/team/markdown as React elements: every piece of text goes through React as text,
// never as HTML, so a prompt can only ever show its own characters. Headings move down by `headingBase` levels to sit
// under the page's own headings. Tables scroll sideways inside their frame on a phone; code wraps instead of
// widening the page.

const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

const HEADING_CLASS: Record<number, string> = {
  1: "mt-6 text-lg font-semibold text-[#f0f1f5]",
  2: "mt-6 text-base font-semibold text-[#f0f1f5]",
};

const ALIGN: Record<Exclude<Align, null>, string> = { left: "text-left", center: "text-center", right: "text-right" };

function InlineView({ content }: { content: readonly Inline[] }): ReactNode {
  return content.map((n, i) => {
    switch (n.kind) {
      case "text":
        return n.text;
      case "code":
        // These two palette names are checked by markdown.test.ts; globals.css points them at the theme.
        return (
          <code key={i} className="border border-[var(--line-neutral)] px-1 py-0.5 font-mono text-[0.85em]">
            {n.text}
          </code>
        );
      case "strong":
        return (
          <strong key={i} className="font-semibold text-[var(--track-accent)]">
            <InlineView content={n.children} />
          </strong>
        );
      case "em":
        return (
          <em key={i}>
            <InlineView content={n.children} />
          </em>
        );
    }
  });
}

function BlockView({ block, base, label }: { block: Block; base: number; label: string }): ReactNode {
  switch (block.kind) {
    case "heading": {
      const Tag = HEADINGS[Math.min(block.level + base, 6) - 1]!;
      return (
        <Tag className={`${HEADING_CLASS[block.level] ?? "mt-4 text-sm font-semibold text-[var(--track-accent)]"} first:mt-0`}>
          <InlineView content={block.content} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className="mt-3 first:mt-0">
          <InlineView content={block.content} />
        </p>
      );
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i} className="pl-1">
          <Blocks blocks={item} base={base} label={label} />
        </li>
      ));
      return block.ordered ? (
        <ol start={block.start === 1 ? undefined : block.start} className="mt-3 list-decimal space-y-1 pl-5 marker:text-muted first:mt-0 [li_&]:mt-1">
          {items}
        </ol>
      ) : (
        <ul className="mt-3 list-disc space-y-1 pl-5 marker:text-muted first:mt-0 [li_&]:mt-1">{items}</ul>
      );
    }
    case "table": {
      const align = (k: number) => {
        const a = block.align[k];
        return a ? ALIGN[a] : "text-left";
      };
      return (
        <div
          role="region"
          aria-label={`${label}: table of ${block.head.map((h) => inlineText(h)).join(", ")}`}
          tabIndex={0}
          className="mt-3 overflow-x-auto border border-[var(--line-neutral)] first:mt-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--track-accent)]"
        >
          <table className="guide-table min-w-[36rem] [overflow-wrap:normal]">
            <thead>
              <tr>
                {block.head.map((h, k) => (
                  <th key={k} scope="col" className={align(k)}>
                    <InlineView content={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, k) => (
                    <td key={k} className={`align-top ${align(k)}`}>
                      <InlineView content={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "code":
      return (
        <pre className="mt-3 whitespace-pre-wrap border border-[var(--line-neutral)] px-3 py-2 font-mono text-[11px] leading-relaxed [overflow-wrap:anywhere] first:mt-0">
          <code>{block.text}</code>
        </pre>
      );
  }
}

function Blocks({ blocks, base, label }: { blocks: readonly Block[]; base: number; label: string }) {
  return blocks.map((b, i) => <BlockView key={i} block={b} base={base} label={label} />);
}

/** A Markdown document (parsed with lib/team/markdown's parseMarkdown). `label` names its tables for screen readers. */
export function Markdown({ blocks, label, headingBase = 0 }: { blocks: readonly Block[]; label: string; headingBase?: number }) {
  return (
    <div className="text-[12px] leading-relaxed">
      <Blocks blocks={blocks} base={headingBase} label={label} />
    </div>
  );
}
