// The control panel's building blocks: the shared demo-markup primitives (components/ui/ui.tsx: .guide-panel,
// .guide-metric, .guide-table, .guide-chip, .guide-alert, .guide-btn, .guide-input). The console's tables scroll
// inside a short box (.guide-scroll-box.table-8) so a long list never pushes the panel's controls off the screen.

import type { ComponentProps } from "react";
import { Table as SharedTable } from "@/components/ui/ui";

export { Panel, Badge, Td, Stat, Notice, buttonClass, inputClass, type Tone } from "@/components/ui/ui";

export function Table({ className = "", ...props }: ComponentProps<typeof SharedTable>) {
  return <SharedTable {...props} className={`guide-scroll-box table-8 ${className}`} />;
}
