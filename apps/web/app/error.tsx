"use client";

// The last net for an error no section catches (for example the sign-in check of an area's layout failing to read
// the account). The big screen retries on its own; anywhere else the person can try again.

import { usePathname } from "next/navigation";
import { RetryScreen } from "@/components/retry-screen";
import "@/styles/primus/demo.css";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const path = usePathname();
  if (path?.startsWith("/display")) return <RetryScreen error={error} retry={retry} />;
  return (
    // The demo's panel (app/demo/demo.css), on the demo's background.
    <main className="guide-app flex min-h-dvh items-center justify-center px-4">
      <div className="guide-atmosphere" />
      <section className="guide-panel relative w-full max-w-xl">
        <div className="guide-panel-head">
          <h1 className="text-[12px] font-bold">This page could not load</h1>
          <span>PRIMUS ’26</span>
        </div>
        <div className="guide-panel-body">
          <p className="guide-alert guide-warning">Nothing was changed. Try again in a moment.</p>
          {error.digest ? <p className="guide-muted mt-2 font-mono">{error.digest}</p> : null}
          <button type="button" onClick={() => retry()} className="guide-btn mt-4">
            Try again
          </button>
        </div>
      </section>
    </main>
  );
}
