"use client";

// The projector's two views from READING on (lib/display/rotation.ts), switched by hand: SECTORS (one column per
// sector of the draw, each paging through all its companies with their latest update) and TEAMS (a spotlight card
// per registered company, SPOTLIGHT_MS each, looping). The toggle sits in the top-right corner and shows only for a
// moment after the mouse moves, so it never shows on the projected image; the "T" key toggles too. The choice is kept
// per screen in the browser (a reload keeps it). Both views come from the same server render: switching costs no
// query. The first render (on the server and while hydrating) is the default view at the server's render time.

import "@/styles/primus/sector-columns.css";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useServerNow } from "@/lib/live/clock";
import { bp, money } from "@/lib/format";
import { MOVE_ARROWS, MOVE_TONE, pageCount, pageOf, toneOf } from "@/lib/display/board";
import {
  DEFAULT_VIEW,
  TOGGLE_HIDE_MS,
  VIEW_STORAGE_KEY,
  columnLayout,
  columnPageAt,
  isToggleKey,
  otherView,
  parseView,
  spotlightCards,
  spotlightIndex,
  type ColumnLayout,
  type DisplayTeam,
  type ScreenView,
  type SectorColumn,
  type SectorRow,
  type SpotlightEntry,
} from "@/lib/display/rotation";
import {
  TIMER_STEPS_MIN,
  TIMER_STORAGE_KEY,
  adjustOverride,
  overrideFromClock,
  overrideFromMinutes,
  overrideReached,
  parseOverride,
  remainingText,
  type TimerOverride,
} from "@/lib/display/timer-override";
import { sectorStyle } from "@/lib/team/sectors";
import { Glyph } from "@/components/ui/matrix";

const noSubscription = () => () => {};
const TONE = { up: "text-emerald-400", down: "text-red-500", flat: "text-paper" } as const;

function readView(): ScreenView {
  try {
    return parseView(window.localStorage.getItem(VIEW_STORAGE_KEY));
  } catch {
    return DEFAULT_VIEW;
  }
}

function storeView(v: ScreenView) {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, v);
  } catch {
    // Private window or blocked storage: the view still switches, it is just not remembered.
  }
}

function readTimer(): TimerOverride | null {
  try {
    return parseOverride(window.localStorage.getItem(TIMER_STORAGE_KEY));
  } catch {
    return null;
  }
}

function storeTimer(t: TimerOverride | null) {
  try {
    if (t) window.localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(t));
    else window.localStorage.removeItem(TIMER_STORAGE_KEY);
  } catch {
    // Blocked storage: the timer still runs on this screen until a reload.
  }
}

/** The manual timer, large, over both views: the label and MM:SS; at zero "00:00" and the label flashing. */
function OverrideStrip({ timer, now }: { timer: TimerOverride; now: number }) {
  const done = overrideReached(timer, now);
  return (
    <div className="guide-panel guide-stage-strip mx-6 mt-3 flex shrink-0 items-center justify-center gap-10 px-6 py-2" data-testid="display-timer">
      <span className={`text-[44px] font-black uppercase ${done ? "sector-timer-flash text-warn" : "text-paper"}`}>{timer.label}</span>
      <span className={`font-mono text-[72px] leading-none font-black tabular-nums ${done ? "text-warn" : "text-phosphor glow"}`}>{remainingText(timer, now)}</span>
    </div>
  );
}

/** The hidden panel's "Set timer": label, then minutes from now or HH:MM (IST); the steps; Clear. */
function TimerPanel({ now, timer, onSet }: { now: number; timer: TimerOverride | null; onSet: (t: TimerOverride | null) => void }) {
  const [label, setLabel] = useState(timer?.label ?? "");
  const [when, setWhen] = useState("");
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    const t = when.includes(":") ? overrideFromClock(now, when, label) : overrideFromMinutes(now, Number(when), label);
    if (!t) return setError("Minutes (e.g. 10) or a time HH:MM (IST)");
    setError(null);
    onSet(t);
  };
  // Typing in the panel must not toggle the view.
  const stop = (e: React.KeyboardEvent) => e.stopPropagation();
  return (
    <div className="sector-timer-panel" onKeyDown={stop} data-testid="display-timer-panel">
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (Break ends)" aria-label="Timer label" />
      <input value={when} onChange={(e) => setWhen(e.target.value)} placeholder="Minutes or HH:MM" aria-label="Minutes from now or HH:MM IST" />
      <button type="button" onClick={apply}>
        Start
      </button>
      {timer ? (
        <>
          {TIMER_STEPS_MIN.map((m) => (
            <button key={m} type="button" onClick={() => onSet(adjustOverride(timer, m, now))}>
              {m > 0 ? `+${m}` : `−${-m}`} min
            </button>
          ))}
          <button type="button" onClick={() => onSet(null)}>
            Clear (back to schedule)
          </button>
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

export function SectorRotation({
  columns,
  teams,
  serverTime,
  compact = false,
}: {
  columns: SectorColumn[];
  /** The listed teams (display_teams); null on an older database (the spotlight then shows the companies). */
  teams: DisplayTeam[] | null;
  serverTime: string;
  compact?: boolean;
}) {
  const live = useServerNow(500);
  const hydrated = useSyncExternalStore(noSubscription, () => true, () => false);
  const now = hydrated ? live : Date.parse(serverTime);
  const [chosen, setChosen] = useState<ScreenView | null>(null);
  const [toggleShown, setToggleShown] = useState(false);
  const view = hydrated ? (chosen ?? readView()) : DEFAULT_VIEW;

  const toggle = useCallback(() => {
    const next = otherView(chosen ?? readView());
    storeView(next);
    setChosen(next);
  }, [chosen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isToggleKey(e)) toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onMove = () => {
      setToggleShown(true);
      clearTimeout(timer);
      timer = setTimeout(() => setToggleShown(false), TOGGLE_HIDE_MS);
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      clearTimeout(timer);
    };
  }, []);

  const [timer, setTimerState] = useState<TimerOverride | null | undefined>(undefined);
  const [panelOpen, setPanelOpen] = useState(false);
  const override = hydrated ? (timer === undefined ? readTimer() : timer) : null;
  const setTimer = (t: TimerOverride | null) => {
    storeTimer(t);
    setTimerState(t);
  };

  const cards = spotlightCards(columns, teams);
  return (
    <>
      <div className={`sector-view-toggle ${toggleShown || panelOpen ? "is-shown" : ""}`} data-testid="display-controls">
        <button type="button" onClick={toggle} data-testid="display-view-toggle" aria-label={`Show ${otherView(view) === "teams" ? "Teams" : "Sectors"} (T)`}>
          {view === "sectors" ? "Teams ▸" : "Sectors ▸"} <kbd>T</kbd>
        </button>
        <button type="button" onClick={() => setPanelOpen((o) => !o)} data-testid="display-timer-open">
          {panelOpen ? "Close" : "Set timer"}
        </button>
        {panelOpen ? <TimerPanel now={now} timer={override} onSet={setTimer} /> : null}
      </div>
      {override ? <OverrideStrip timer={override} now={now} /> : null}
      {view === "teams" ? <Spotlight cards={cards} now={now} /> : <Columns columns={columns} now={now} compact={compact} />}
    </>
  );
}

// ───────────────────────────── Sectors ─────────────────────────────

function Columns({ columns, now, compact }: { columns: SectorColumn[]; now: number; compact: boolean }) {
  const layout = columnLayout(Math.max(...columns.map((c) => c.rows.length)), compact);
  return (
    <>
      <div
        className="grid min-h-0 flex-1 gap-x-4 px-6 py-2"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
        data-testid="sector-columns"
        data-density={layout.density}
      >
        {columns.map((c) => (
          <Column key={c.sector} column={c} layout={layout} now={now} />
        ))}
      </div>
      <footer className="guide-footer guide-stage-legend flex h-[44px] shrink-0 items-center justify-between gap-8">
        <p className="min-w-0 truncate">Every company of every sector · price · % change since the IPO price · latest update</p>
      </footer>
    </>
  );
}

function Column({ column, layout, now }: { column: SectorColumn; layout: ColumnLayout; now: number }) {
  const style = sectorStyle(column.sector);
  const pages = pageCount(column.rows.length, layout.rows);
  const page = columnPageAt(now, pages);
  const rows = pageOf(column.rows, page, layout.rows);
  return (
    <section className={`guide-panel sector-column flex min-h-0 min-w-0 flex-col border-t-4 ${style.border}`} data-testid={`sector-column-${column.sector}`}>
      <div className="guide-panel-head">
        <h2 className={`${style.text} text-[30px]`}>
          <Glyph e={style.icon} /> {column.sector.toUpperCase()}
        </h2>
        <span className="font-mono tabular-nums" data-testid="sector-column-page">
          {column.rows.length} {column.rows.length === 1 ? "company" : "companies"}
          {pages > 1 ? ` · ${page + 1}/${pages}` : ""}
        </span>
      </div>
      {/* A new key per page: the rows fade in, so a turn reads as a new page from the back of the hall. */}
      <ol
        key={page}
        className="sector-column-page grid min-h-0 flex-1 px-3 py-1"
        style={{ gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))` }}
        data-page={page + 1}
      >
        {rows.map((r) => (layout.density === "roomy" ? <RoomyRow key={r.id} row={r} /> : <DenseRow key={r.id} row={r} />))}
      </ol>
    </section>
  );
}

function Price({ row, className }: { row: SectorRow; className: string }) {
  if (row.price === null) return <span className={`text-muted ${className}`}>IPO pending</span>;
  return (
    <>
      <span className={`shrink-0 font-bold tabular-nums ${className}`} data-testid="sector-row-price">
        {money(row.price)}
      </span>
      <span className={`shrink-0 font-bold tabular-nums ${className} ${TONE[toneOf(row.changeBp)]}`} data-testid="sector-row-change">
        {bp(row.changeBp)}
      </span>
    </>
  );
}

function Update({ row, className }: { row: SectorRow; className: string }) {
  const u = row.update;
  if (!u) return <span className={`min-w-0 truncate text-muted ${className}`}>No update yet</span>;
  return (
    <span className={`min-w-0 truncate text-[#9db1a1] ${className}`} data-testid="sector-row-update">
      {u.text}
      {u.moveBp !== null && u.moveBp !== 0 ? <span className={`font-mono ${TONE[toneOf(u.moveBp)]}`}> {bp(u.moveBp)}</span> : null}
    </span>
  );
}

function RoomyRow({ row }: { row: SectorRow }) {
  return (
    <li className="sector-row flex min-h-0 min-w-0 flex-col justify-center gap-1 border-b border-[#1d3a26] last:border-b-0" data-testid={`sector-row-${row.ticker}`}>
      <div className="flex min-w-0 items-baseline gap-3 leading-none">
        <span className="shrink-0 text-[34px] font-black tracking-tight">{row.ticker}</span>
        <span className="min-w-0 flex-1 truncate text-[22px] text-[#9db1a1]">{row.name}</span>
        <Price row={row} className="text-[30px]" />
      </div>
      <Update row={row} className="text-[22px] leading-tight" />
    </li>
  );
}

function DenseRow({ row }: { row: SectorRow }) {
  return (
    <li className="sector-row flex min-h-0 min-w-0 items-center gap-3 border-b border-[#1d3a26] leading-none last:border-b-0" data-testid={`sector-row-${row.ticker}`}>
      <span className="w-[92px] shrink-0 truncate text-[24px] font-black tracking-tight">{row.ticker}</span>
      <Price row={row} className="text-[22px]" />
      <Update row={row} className="flex-1 text-right text-[18px]" />
    </li>
  );
}

// ───────────────────────────── Teams ─────────────────────────────

function Spotlight({ cards, now }: { cards: SpotlightEntry[]; now: number }) {
  const i = spotlightIndex(now, cards.length);
  const card = i === null ? null : cards[i];
  return (
    <>
      <div className="flex min-h-0 flex-1 items-center justify-center px-24 py-6" data-testid="team-spotlight">
        {card ? <SpotlightCard key={card.key} card={card} /> : <p className="guide-panel px-16 py-10 text-[48px] font-bold text-[#9db1a1]">No registered teams yet.</p>}
      </div>
      <footer className="guide-footer guide-stage-legend flex h-[44px] shrink-0 items-center justify-between gap-8">
        <p className="min-w-0 truncate">Team spotlight · every registered team of every track in turn</p>
        {i !== null ? (
          <p className="guide-status shrink-0 tabular-nums" data-testid="team-spotlight-count">
            {i + 1} / {cards.length}
          </p>
        ) : null}
      </footer>
    </>
  );
}

const TRACK_LABEL = { PRODUCT: "Product", CONSULTING: "Consulting", FINANCE: "Finance" } as const;

/** The card's frame: the track line on top, the team's code and name large, then the track's facts. */
function CardFrame({ card, border, eyebrow, children }: { card: SpotlightEntry; border: string; eyebrow: React.ReactNode; children: React.ReactNode }) {
  return (
    <section
      className={`guide-metric guide-tile sector-spotlight-card flex w-full max-w-[1500px] flex-col gap-8 border-l-8 px-14 py-10 ${border}`}
      data-testid={`spotlight-${card.key}`}
      data-track={card.track}
    >
      <span className="text-[34px] font-bold tracking-wide uppercase">{eyebrow}</span>
      {card.code ? (
        <div className="flex min-w-0 items-baseline gap-10">
          <span className="shrink-0 font-mono text-[120px] leading-none font-black tracking-tight glow" data-testid="spotlight-code">
            {card.code}
          </span>
          <span className="min-w-0 truncate text-[64px] font-bold" data-testid="spotlight-name">
            {card.name}
          </span>
        </div>
      ) : null}
      {children}
    </section>
  );
}

function SpotlightCard({ card }: { card: SpotlightEntry }) {
  if (card.track === "CONSULTING") {
    return (
      <CardFrame card={card} border="border-[#4fb8ff]" eyebrow={<span className="text-[#8fd6ff]">Consulting · firm</span>}>
        <div className="flex items-baseline gap-16 tabular-nums">
          <span className="text-[56px]">
            <span className="text-muted">Base rate </span>
            <b>{card.baseRateBp === null ? "—" : `${(card.baseRateBp / 100).toFixed(2)}%`}</b>
          </span>
          <span className="text-[56px]">
            <span className="text-muted">Clients </span>
            <b>{card.clients}</b>
          </span>
        </div>
      </CardFrame>
    );
  }
  if (card.track === "FINANCE") {
    return (
      <CardFrame card={card} border="border-[#ffb000]" eyebrow={<span className="text-[#ffd25c]">Finance · fund</span>}>
        <p className="text-[40px] text-muted">Portfolio revealed at the awards.</p>
      </CardFrame>
    );
  }
  const { row, sector } = card;
  const style = sectorStyle(sector ?? "");
  return (
    <CardFrame
      card={card}
      border={style.border}
      eyebrow={
        <span className={style.text}>
          {sector ? (
            <>
              <Glyph e={style.icon} /> {sector} ·{" "}
            </>
          ) : null}
          {TRACK_LABEL.PRODUCT}
        </span>
      }
    >
      {row ? <CompanyFacts row={row} big={!card.code} /> : <p className="text-[40px] text-muted">Company listed from the Reading phase.</p>}
    </CardFrame>
  );
}

function CompanyFacts({ row, big }: { row: SectorRow; big: boolean }) {
  const tone = toneOf(row.changeBp);
  return (
    <>
      <div className="flex min-w-0 items-baseline gap-10">
        <span className={`shrink-0 leading-none font-black tracking-tight ${big ? "text-[150px] glow" : "text-[72px] text-phosphor"}`}>{row.ticker}</span>
        <span className={`min-w-0 truncate text-[#9db1a1] ${big ? "text-[56px]" : "text-[44px]"}`}>{row.name}</span>
        {row.move ? <span className={`ml-auto shrink-0 text-[64px] leading-none ${TONE[MOVE_TONE[row.move]]}`}>{MOVE_ARROWS[row.move]}</span> : null}
      </div>
      {row.price === null ? (
        <p className="text-[56px] font-semibold text-muted">IPO price pending</p>
      ) : (
        <div className="flex items-baseline gap-12 tabular-nums">
          <span className="text-[100px] leading-none font-bold">{money(row.price)}</span>
          <span className={`text-[72px] leading-none font-bold ${TONE[tone]}`}>{bp(row.changeBp)}</span>
          <span className="text-[30px] text-muted">{row.closing ? "closing price · since IPO" : "since IPO"}</span>
        </div>
      )}
      <p className="min-w-0 truncate border-t border-[#1d3a26] pt-6 text-[44px]" data-testid="spotlight-update">
        <span className="text-muted">Latest · </span>
        {row.update ? (
          <>
            {row.update.text}
            {row.update.moveBp !== null && row.update.moveBp !== 0 ? <span className={`font-mono ${TONE[toneOf(row.update.moveBp)]}`}> {bp(row.update.moveBp)}</span> : null}
          </>
        ) : (
          <span className="text-muted">No update yet</span>
        )}
      </p>
    </>
  );
}
