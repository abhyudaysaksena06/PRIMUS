import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// One device per team (migration 104): a device whose session was revoked by a sign-in elsewhere lands here. Its
// cookies are cleared (a page cannot set cookies while it renders) and it goes to the sign-in page with a reason.
export async function GET(request: NextRequest) {
  const sb = await supabaseServer();
  await sb.auth.signOut({ scope: "local" });
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "?other=1";
  return NextResponse.redirect(url);
}
