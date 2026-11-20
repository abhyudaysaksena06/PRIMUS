"use client";

// The open round's orders: each can have its quantity changed (edit_order, checked as it is typed with the engine,
// the order itself left out of the pending totals) or be cancelled (cancel_order) until the round closes by the server
// clock. Both are one click: until the round closes, an edit can be changed back and a cancelled order placed again.

import { startTransition, useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import type { OrderContext } from "@msim/engine";
import type { ActionResult } from "@/lib/rpc";
import { editContext, maxOrder, orderLabel, parseShares, previewOrder, type OrderLine } from "@/lib/team/trade";
import { clock, count, money } from "@/lib/format";
import { useServerNow } from "@/lib/live/clock";
import { ActionButton, ResultMessage } from "@/components/ui/action";
import { useCarried, useCarrier } from "@/lib/live/feedback";
import { safely } from "@/components/ui/action-helpers";

/** The demo ticket's quantity field, narrow. */
const narrowInput = "block w-28 h-9 px-3 bg-[#11110d] border border-[#2d2a1d] focus:border-[color:var(--desk-accent)] focus:outline-none rounded font-mono text-[13px] text-[#F2F5F3] tabular-nums";
/** The demo ticket's small keys (its 25% / 50% / 100% presets) for the edit row. */
const smallKey = "h-9 px-2.5 font-mono text-[11px] font-semibold uppercase rounded border transition-colors disabled:cursor-not-allowed disabled:opacity-45";

/** The blotter's side colours: buys and covers green, sells and shorts red (the desk's up and down). */
const SIDE = { BUY: "text-[#00D68F]", COVER: "text-[#00D68F]", SELL: "text-[#FF5364]", SHORT: "text-[#FF5364]" } as const;

export interface OpenOrderItem {
  line: OrderLine;
  edit: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  cancel: () => Promise<ActionResult>;
}

export function OpenOrders({ ctx, items, closesAt, accepting }: { ctx: OrderContext; items: OpenOrderItem[]; closesAt: string; accepting: boolean }) {
  const now = useServerNow(1000);
  const open = accepting && now < new Date(closesAt).getTime();
  return (
    <ul className="-mx-4 divide-y divide-[#1B2420]" aria-label="Open orders">
      {items.map(({ line, edit, cancel }) => {
        const label = orderLabel(line.type, line.qty, line.ticker);
        return (
          <li key={line.id} className="px-4 py-3 hover:bg-[#201e14]/60" data-testid="open-order">
            {/* The demo blotter's row: side and company over the price and time, the status chip on the right. */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className={`font-mono text-xs font-semibold ${SIDE[line.type]}`}>{label}</div>
                <div className="font-mono text-[11px] text-[#87948D] mt-0.5 tabular-nums">
                  @ {money(line.entryPrice)} · {clock(line.createdAt, true)}
                  {line.reserve > 0 ? ` · ${line.type === "SHORT" ? "collateral" : "cash"} reserved ${money(line.reserve)}` : ""}
                </div>
              </div>
              <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] px-2 py-0.5 rounded-sm border bg-[var(--desk-accent-soft)] border-[color:var(--desk-accent-line)] text-[color:var(--desk-accent)]">
                Open
              </span>
            </div>
            {open ? (
              <div className="mt-2 space-y-2">
                <EditOrder key={`${line.id}:${line.qty}`} ctx={ctx} line={line} label={label} action={edit} />
                <ActionButton action={cancel} variant="danger">
                  Cancel order
                </ActionButton>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function EditOrder({ ctx, line, label, action }: { ctx: OrderContext; line: OrderLine; label: string; action: OpenOrderItem["edit"] }) {
  const router = useRouter();
  const [qty, setQty] = useState(String(line.qty));
  const [maxNote, setMaxNote] = useState<string | null>(null);
  const ectx = editContext(ctx, line.id);
  const preview = previewOrder(ectx, line.companyId, line.type, qty);
  const unchanged = parseShares(qty) === line.qty;
  // A refusal the screen predicts is not sent; a change the screen cannot check is (the exchange decides).
  const sendable = (preview.state === "OK" || preview.state === "UNKNOWN") && !unchanged;
  const carrier = useCarrier();
  const [result, dispatch, pending] = useActionState<ActionResult | null, FormData>(async (prev, form) => {
    const r = await safely(() => action(prev, form));
    carrier.deliver(r);
    router.refresh();
    return r;
  }, null);
  useCarried(carrier, result);
  return (
    <form
      aria-label={`Change ${label}`}
      className="min-w-0"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending || !sendable) return;
        const form = new FormData(e.currentTarget);
        startTransition(() => dispatch(form));
      }}
    >
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor={`qty-${line.id}`}>
          New quantity for {label}
        </label>
        <input
          id={`qty-${line.id}`}
          name="qty"
          inputMode="numeric"
          autoComplete="off"
          value={qty}
          onChange={(e) => {
            setQty(e.target.value);
            setMaxNote(null);
          }}
          className={narrowInput}
        />
        <button
          type="button"
          className={`${smallKey} bg-[#11110d] border-[color:var(--desk-accent-line)] text-[color:var(--desk-accent)] hover:bg-[var(--desk-accent-soft)]`}
          onClick={() => {
            const m = maxOrder(ectx, line.companyId, line.type);
            if (m.max > 0) {
              setQty(String(m.max));
              setMaxNote(null);
            } else setMaxNote(`No ${line.type} of ${line.ticker} would pass right now: ${m.reason ?? "check the limits under Positions."}`);
          }}
        >
          Max
        </button>
        <button
          type="submit"
          disabled={pending || !sendable}
          className={`${smallKey} bg-[var(--desk-accent)] border-[color:var(--desk-accent)] text-[#070909] enabled:hover:bg-[var(--desk-accent-hover)]`}
        >
          {pending ? "Saving…" : "Change quantity"}
        </button>
      </div>
      {maxNote ? (
        <p className="mt-1 text-sm text-danger-soft" role="alert">
          {maxNote}
        </p>
      ) : preview.state === "REFUSED" ? (
        <p className="mt-1 text-sm text-danger-soft">The exchange would refuse this change: {preview.message}</p>
      ) : preview.state === "UNKNOWN" ? (
        <p className="mt-1 text-sm text-warn">{preview.message}</p>
      ) : preview.state === "OK" && !unchanged && preview.reserve > 0 ? (
        <p className="mt-1 text-xs text-paper">
          {count(preview.qty)} shares reserve {money(preview.reserve)}; available cash after the change {money(preview.availableAfter)}.
        </p>
      ) : null}
      <ResultMessage result={result} />
    </form>
  );
}
