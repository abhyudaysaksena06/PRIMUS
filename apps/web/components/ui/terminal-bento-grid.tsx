// The bento grid: a grid of cards in the PRIMUS demo's look (gradient card, hairline edge in the track's colour).
// The look lives in globals.css (.terminal-container, .bento-grid, .bento-item, .blinking-cursor), drawn from the
// track's tokens.

import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

/** How many columns an item takes once the grid has room (one column on a phone, two on a tablet, three on a laptop). */
export type BentoSpan = 1 | 2 | 3;

const SPAN: Record<BentoSpan, string> = {
  1: "",
  2: "sm:col-span-2",
  3: "sm:col-span-2 lg:col-span-3",
};

type BentoItemProps<T extends ElementType> = {
  /** The element to render (a section for a titled card, an li inside a list). Defaults to a div. */
  as?: T;
  span?: BentoSpan;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "className" | "children">;

/** One cell of the grid. Extra props (aria-label, data-testid, …) are passed to the element. */
const BentoItem = <T extends ElementType = "div">({ as, span = 1, className = "", children, ...rest }: BentoItemProps<T>) => {
  const Tag: ElementType = as ?? "div";
  return (
    <Tag className={`bento-item ${SPAN[span]} ${className}`} {...rest}>
      {children}
    </Tag>
  );
};

/** The grid itself: one column on a phone, two from `sm`, three from `lg`. */
export function BentoGrid({ className = "", children, ...rest }: ComponentPropsWithoutRef<"div">) {
  return (
    <div className={`bento-grid ${className}`} {...rest}>
      {children}
    </div>
  );
}

/** A terminal window's title line: "> TITLE", with the prompt drawn as decoration. */
export function BentoTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={`flex min-w-0 items-center gap-2 font-mono text-base font-bold tracking-wide text-[var(--mx-heading)] ${className}`}>
      <span aria-hidden className="text-phosphor">
        &gt;
      </span>
      {children}
    </h2>
  );
}

export { BentoItem };
export default BentoItem;
