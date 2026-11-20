"use client";

// The team's sections, as the demo's sidebar (app/demo/layout.tsx): the PRIMUS mark, "PRODUCT WORKSPACE ///", the
// numbered sections, then the look-up pages, and the team at the bottom. On a phone it is a row of tabs (team.css).

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { TeamSection } from "@/lib/team/sections";

const LOOK_UP = new Set(["/market", "/qa", "/ledger", "/bulletins", "/judging"]);

export interface NavTeam {
  code: string;
  name: string;
  /** The workspace's name in capitals, e.g. "PRODUCT". */
  track: string;
}

export function TeamNav({ sections, team }: { sections: readonly TeamSection[]; team?: NavTeam }) {
  const pathname = usePathname();
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const row = nav.current?.querySelector<HTMLElement>(".mx-team-command-links");
    const tab = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !tab) return;
    const r = row.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    if (t.left < r.left || t.right > r.right) row.scrollLeft += t.left - r.left - (r.width - t.width) / 2;
  }, [pathname]);
  const work = sections.filter((s) => !LOOK_UP.has(s.path));
  const lookUp = sections.filter((s) => LOOK_UP.has(s.path));
  const link = (s: TeamSection, n: number) => {
    const href = `/team${s.path}`;
    const active = s.path === "" ? pathname === "/team" : pathname.startsWith(href);
    return (
      <Link key={s.path} href={href} aria-current={active ? "page" : undefined} className={active ? "is-active" : ""}>
        <small aria-hidden>{String(n).padStart(2, "0")}</small>
        {s.label}
        <i aria-hidden>↗</i>
      </Link>
    );
  };
  return (
    <nav ref={nav} className="mx-team-command-nav" aria-label="Competition workspace">
      <div className="mx-team-command-brand" aria-hidden>
        <Image src="/primus-logo-light.svg" alt="" width={52} height={20} />
        <span>
          <strong>
            PRIMUS <i>’26</i>
          </strong>
          <small>MATRIX NETWORK</small>
        </span>
      </div>
      <p className="mx-team-command-label">
        {team ? `${team.track} WORKSPACE` : "WORKSPACE"} <b aria-hidden>{"///"}</b>
      </p>
      <div className="mx-team-command-links">
        {work.map((s, i) => link(s, i + 1))}
        {lookUp.length ? <p className="mx-team-command-label">INTELLIGENCE</p> : null}
        {lookUp.map((s, i) => link(s, work.length + i + 1))}
      </div>
      <div className="mx-team-command-footer">
        <span className="mx-team-command-live">
          <i /> CONNECTION LIVE
        </span>
        {team ? (
          <div className="mx-team-command-team">
            <span className="mx-team-command-avatar" aria-hidden>
              {team.code.slice(0, 2)}
            </span>
            <span>
              <b>{team.name}</b>
              <small>
                TEAM {team.code} · {team.track}
              </small>
            </span>
          </div>
        ) : null}
      </div>
    </nav>
  );
}
