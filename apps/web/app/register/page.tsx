import type { Metadata } from "next";
import { supabaseService } from "@/lib/supabase/service";
import { RegisterForm } from "./register-form";
import "@/styles/primus/demo.css";

export const metadata: Metadata = { title: "Register your team · PRIMUS" };
export const dynamic = "force-dynamic";

interface Info {
  slug?: string;
  name?: string;
  open: boolean;
}

async function registrationInfo(slug: string | null): Promise<Info> {
  try {
    const { data, error } = await supabaseService().rpc("registration_info", { p_slug: slug });
    return error || !data ? { open: false } : (data as Info);
  } catch {
    return { open: false };
  }
}

// Public: teams register before the night and get a serial number. The organisers open and close the form on the
// control panel's Desk page; the link is /register (the event with registration open) or /register?event=<slug>.
export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { event } = await searchParams;
  const info = await registrationInfo(typeof event === "string" && event ? event : null);

  return (
    // The demo's entry page (app/demo/login): the grid and glow, then one entry card.
    <main className="demo-entry">
      <div className="demo-login-grid" />
      <div className="demo-login-glow" />
      <div className="demo-entry-wrap max-w-xl">
        <section className="demo-entry-card">
          <div className="demo-entry-eyebrow">
            PRIMUS ’26 <b>{"///"}</b> TEAM REGISTRATION
          </div>
          <div className="demo-entry-card-top">
            <div>
              <h1>
                Register your <em>team</em>
              </h1>
              <p>{info.name ?? "PRIMUS"}</p>
            </div>
          </div>
          {info.open && info.slug ? (
            <RegisterForm slug={info.slug} />
          ) : (
            <p className="guide-alert guide-warning mt-6" data-testid="register-closed">
              Registration is closed right now. Check back later, or contact the organisers.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
