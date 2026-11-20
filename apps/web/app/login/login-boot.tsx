"use client";

// The demo's short glitch boot on the sign-in page (app/demo/login): the PRIMUS mark three times over, a rule and three
// lines, gone after 1.5 s. Decoration only: it never takes a click (demo.css: pointer-events none).

import { useEffect, useState } from "react";

export function LoginBoot({ track }: { track: string | null }) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setShow(false), 1500);
    return () => window.clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <div className="demo-glitch-boot" aria-hidden>
      <div className="demo-glitch-noise" />
      <div className="demo-glitch-scan" />
      <div className="demo-glitch-content">
        <div className="demo-glitch-logo">
          {/* eslint-disable-next-line @next/next/no-img-element -- three stacked copies for the glitch, as the demo */}
          <img src="/primus-logo-light.svg" alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/primus-logo-light.svg" alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/primus-logo-light.svg" alt="" />
        </div>
        <div className="demo-glitch-rule" />
        <p>
          PRIMUS <span>{"///"}</span> {track ? `${track} ACCESS NODE` : "ACCESS NODE"}
        </p>
        <div className="demo-glitch-lines">
          <span>
            <i>01</i> INITIALISING NETWORK
          </span>
          <span>
            <i>02</i> VERIFYING TEAM CARD
          </span>
          <span>
            <i>03</i> SIMULATION READY
          </span>
        </div>
      </div>
    </div>
  );
}
