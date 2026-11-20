"use client";

import { useMemo, useState } from "react";
import { Activity, ArrowUpRight, Bell, BriefcaseBusiness, ChartNoAxesCombined, Clock3, Radio, Rocket, ShieldAlert, Sparkles, TrendingUp } from "lucide-react";

type Track = "PRODUCT" | "CONSULTING" | "FINANCE";
type Update = { id: string; time: string; type: "MILESTONE" | "SUBMISSION" | "MARKET" | "BULLETIN" | "ALERT"; title: string; detail: string; team: string; ticker?: string };

const TRACKS: { id: Track; label: string; sub: string; Icon: typeof Rocket; tone: string; updates: Update[] }[] = [
  { id: "PRODUCT", label: "PRODUCT", sub: "Build · Launch · Scale", Icon: Rocket, tone: "green", updates: [
    { id:"p1",time:"22:14:08",type:"MILESTONE",title:"Pitch submitted",detail:"A new venture pitch has entered the review queue.",team:"TEAM P-07",ticker:"NOVA"},
    { id:"p2",time:"22:11:42",type:"SUBMISSION",title:"Rescue plan uploaded",detail:"The team has submitted its response to the latest crisis.",team:"TEAM P-12",ticker:"VRTX"},
    { id:"p3",time:"22:08:19",type:"ALERT",title:"Crisis response window open",detail:"Product teams can now review the new scenario and prepare their response.",team:"SYSTEM"},
    { id:"p4",time:"22:02:51",type:"MILESTONE",title:"Company profile updated",detail:"A team has completed its company profile and ticker details.",team:"TEAM P-03",ticker:"HELI"},
    { id:"p5",time:"21:58:04",type:"SUBMISSION",title:"Business plan submitted",detail:"A business plan is ready for evaluation.",team:"TEAM P-09",ticker:"MINT"}
  ]},
  { id: "CONSULTING", label: "CONSULTING", sub: "Advise · Execute · Deliver", Icon: BriefcaseBusiness, tone: "cyan", updates: [
    { id:"c1",time:"22:13:26",type:"MILESTONE",title:"Client engagement opened",detail:"A consulting team has started a new company engagement.",team:"TEAM C-04"},
    { id:"c2",time:"22:09:13",type:"SUBMISSION",title:"Strategy memo submitted",detail:"The team's recommendation has been sent for review.",team:"TEAM C-11"},
    { id:"c3",time:"22:05:47",type:"ALERT",title:"New crisis brief released",detail:"Updated client information is available to consulting teams.",team:"SYSTEM"},
    { id:"c4",time:"22:01:02",type:"MILESTONE",title:"Deal confirmed",detail:"A company has accepted a consulting engagement.",team:"TEAM C-02"},
    { id:"c5",time:"21:54:39",type:"SUBMISSION",title:"Analysis delivered",detail:"A new analysis has been added to the evaluation queue.",team:"TEAM C-08"}
  ]},
  { id: "FINANCE", label: "FINANCE", sub: "Analyse · Invest · Trade", Icon: ChartNoAxesCombined, tone: "violet", updates: [
    { id:"f1",time:"22:14:51",type:"MARKET",title:"Market movement detected",detail:"Trading activity has moved a listed company's price.",team:"EXCHANGE",ticker:"NOVA"},
    { id:"f2",time:"22:10:32",type:"MILESTONE",title:"Trade executed",detail:"A fund order has been matched and recorded.",team:"TEAM F-06"},
    { id:"f3",time:"22:06:18",type:"MARKET",title:"Trading round cleared",detail:"The latest market prices have been calculated.",team:"EXCHANGE"},
    { id:"f4",time:"22:00:43",type:"ALERT",title:"Trading window is live",detail:"Funds can now submit orders for the current round.",team:"SYSTEM"},
    { id:"f5",time:"21:56:10",type:"MILESTONE",title:"Portfolio updated",detail:"A fund has changed its holdings.",team:"TEAM F-03"}
  ]}
];

const TYPE: Record<Update["type"], { label: string; Icon: typeof Activity }> = {
  MILESTONE: { label:"MILESTONE", Icon:Sparkles },
  SUBMISSION: { label:"SUBMISSION", Icon:ArrowUpRight },
  MARKET: { label:"MARKET", Icon:TrendingUp },
  BULLETIN: { label:"BULLETIN", Icon:Bell },
  ALERT: { label:"SYSTEM ALERT", Icon:ShieldAlert }
};

export function NewsroomView() {
  const [filter, setFilter] = useState<"ALL" | Update["type"]>("ALL");
  const all = useMemo(() => TRACKS.reduce((n,t) => n + t.updates.length, 0), []);
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      <div className="flex flex-col gap-4 border-b border-[var(--pd-line)] pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] font-bold tracking-[.24em] text-[var(--pd-accent-2)]"><Radio className="size-3.5 motion-safe:animate-pulse"/> PRIMUS BROADCAST NETWORK <span className="text-[var(--pd-muted)]">/ PUBLIC FEED</span></div>
          <h1 className="font-mono text-3xl font-bold tracking-tight text-[var(--pd-text)] md:text-4xl">THE NEWSROOM<span className="text-[var(--pd-accent)]">.</span></h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--pd-muted)]">Live competition intelligence from all three tracks. Follow every milestone as the night unfolds.</p>
        </div>
        <div className="flex items-center gap-4 self-start md:self-auto">
          <div className="rounded-xl border border-[var(--pd-line-hi)] bg-[var(--pd-soft)] px-3 py-2"><div className="flex items-center gap-2 text-[10px] font-mono tracking-widest text-[var(--pd-accent-2)]"><i className="size-1.5 rounded-full bg-[var(--pd-accent)] shadow-[0_0_8px_var(--pd-accent)]"/> LIVE FEED</div><div className="mt-1 font-mono text-xl font-bold text-white">{String(all).padStart(2,"0")} <span className="text-[10px] font-normal text-[var(--pd-muted)]">UPDATES</span></div></div>
          <div className="hidden rounded-xl border border-[var(--pd-line)] bg-black/20 px-3 py-2 sm:block"><div className="text-[10px] font-mono tracking-widest text-[var(--pd-muted)]">EVENT STATUS</div><div className="mt-1 font-mono text-sm text-[var(--pd-text)]">IN PROGRESS</div></div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" aria-label="Filter updates">
          {(["ALL","MILESTONE","SUBMISSION","MARKET","ALERT"] as const).map(x => <button key={x} onClick={()=>setFilter(x)} className={`rounded-lg border px-3 py-1.5 font-mono text-[10px] tracking-wider transition-colors ${filter===x?"border-[var(--pd-accent)] bg-[var(--pd-accent)]/10 text-[var(--pd-accent-2)]":"border-[var(--pd-line)] text-[var(--pd-muted)] hover:border-[var(--pd-line-hi)] hover:text-white"}`}>{x==="ALL"?"ALL UPDATES":x}</button>)}
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono tracking-wider text-[var(--pd-muted)]"><Clock3 className="size-3.5"/> TIMESTAMPS · EVENT TIME</div>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-3">
        {TRACKS.map(({id,label,sub,Icon,tone,updates}) => {
          const visible = updates.filter(u => filter==="ALL" || u.type===filter);
          return <section key={id} className="min-w-0 overflow-hidden rounded-[14px] border border-[var(--pd-line)] shadow-[var(--pd-shadow)] bg-[image:var(--pd-panel)]" aria-label={label+" live updates"}>
            <header className="flex items-center justify-between border-b border-[var(--pd-line)] bg-[image:var(--pd-head)] px-4 py-4">
              <div className="flex items-center gap-3"><div className={`grid size-9 place-items-center border ${tone==="green"?"border-[var(--pd-line-hi)] bg-[var(--pd-accent)]/10 text-[var(--pd-accent-2)]":tone==="cyan"?"border-cyan-900 bg-cyan-400/10 text-cyan-300":"border-violet-900 bg-violet-400/10 text-violet-300"}`}><Icon className="size-4"/></div><div><h2 className="font-mono text-sm font-bold tracking-widest text-white">{label}</h2><p className="mt-0.5 text-[10px] text-[var(--pd-muted)]">{sub}</p></div></div>
              <span className="font-mono text-xs text-[var(--pd-muted)]">{String(visible.length).padStart(2,"0")} <span className="text-[9px]">ITEMS</span></span>
            </header>
            <div className="min-h-[460px]">
              {visible.length===0 ? <p className="p-5 text-xs text-[var(--pd-muted)]">No updates in this category.</p> : visible.map((u,i) => {const meta=TYPE[u.type];const ItemIcon=meta.Icon;return <article key={u.id} className="relative border-b border-[var(--pd-line)] px-4 py-4 last:border-0 hover:bg-[var(--pd-soft)]"><div className="mb-2 flex items-center justify-between gap-2"><span className={`inline-flex items-center gap-1.5 font-mono text-[9px] tracking-widest ${u.type==="ALERT"?"text-amber-300":u.type==="MARKET"?"text-violet-300":"text-[var(--pd-accent-2)]"}`}><ItemIcon className="size-3"/>{meta.label}</span><time className="font-mono text-[10px] tabular-nums text-[var(--pd-muted)]">{u.time}</time></div><h3 className="text-sm font-semibold leading-snug text-[var(--pd-text)]">{u.title}</h3><p className="mt-1.5 text-xs leading-relaxed text-[var(--pd-muted)]">{u.detail}</p><div className="mt-3 flex items-center justify-between gap-2"><span className="font-mono text-[10px] tracking-wider text-[var(--pd-body)]">{u.team}</span>{u.ticker?<span className="border rounded-full border-[var(--pd-line-hi)] bg-[var(--pd-soft)] px-2 py-0.5 font-mono text-[10px] text-[var(--pd-accent-2)]">{u.ticker}</span>:<span className="text-[9px] text-[var(--pd-muted)]">#{String(i+1).padStart(2,"0")}</span>}</div></article>})}
            </div>
            <footer className="border-t border-[var(--pd-line)] bg-black/20 px-4 py-2 text-[9px] font-mono tracking-widest text-[var(--pd-muted)]">END OF {label} TRANSMISSION</footer>
          </section>;
        })}
      </div>
      <p className="text-center font-mono text-[9px] tracking-[.18em] text-[var(--pd-muted)]">DEMO PREVIEW · SAMPLE ACTIVITY ONLY · LIVE EVENT DATA WILL APPEAR WHEN CONNECTED</p>
    </div>
  );
}
