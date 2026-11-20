// Staff logins for the night as one SQL file for the Supabase SQL editor (pnpm staff-sql): full admins, projector
// screens and the registration, judging and crisis desks (migration 074), each an auth user with a bcrypt password
// (as event-sql.ts creates them) and an account with its role. Passwords derive from CARD_SECRET
// (credentials.ts), so the same secret always gives the same passwords. The file is safe to run again: a login that
// exists keeps its id and gets this file's password, role and name; nothing is created twice; a team login is never
// touched.

import { derivePassword } from "./credentials";

/** The kinds of login, in the order the logins file lists them: flag name → role. */
export const STAFF_KINDS = {
  full: { role: "ORGANISER", label: "Full admin" },
  display: { role: "DISPLAY", label: "Projector" },
  registration: { role: "REGISTRATION", label: "Registration desk" },
  judge: { role: "JUDGE", label: "Judging desk" },
  crisis: { role: "CRISIS", label: "Crisis desk" },
  // Paste and collusion flags are readable and decidable by FAIRNESS only, and an open flag holds APPEALS.
  fairness: { role: "FAIRNESS", label: "Fairness officer" },
} as const;
export type StaffKind = keyof typeof STAFF_KINDS;
export const DEFAULT_COUNTS: Record<StaffKind, number> = { full: 10, display: 5, registration: 2, judge: 1, crisis: 2, fairness: 1 };

/** Passwords are HMAC(CARD_SECRET, "staff:<email>"): separate from every event's team cards. */
export const PASSWORD_SCOPE = "staff";
/** The first schema version with the desk roles. */
export const ROLES_SCHEMA = "20261210000074";

export interface StaffLogin {
  kind: StaffKind;
  email: string;
  password: string;
  role: string;
  /** Shown in the control panel's header, e.g. "Judging desk 01". */
  name: string;
}

const DOMAIN = /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/** Counts from --full/--display/--registration/--judge/--crisis/--fairness flags (whole numbers 0–99; others keep the default). */
export function staffCounts(args: Record<string, string | true>): Record<StaffKind, number> {
  const counts = { ...DEFAULT_COUNTS };
  for (const kind of Object.keys(STAFF_KINDS) as StaffKind[]) {
    const v = args[kind];
    if (v === undefined) continue;
    const n = typeof v === "string" && /^\d{1,2}$/.test(v) ? Number(v) : NaN;
    if (!Number.isInteger(n)) throw new Error(`--${kind} takes a whole number from 0 to 99 (got ${v === true ? "nothing" : v})`);
    counts[kind] = n;
  }
  return counts;
}

export function staffLogins(opts: { domain: string; secret: string; counts: Record<StaffKind, number> }): StaffLogin[] {
  const domain = opts.domain.trim().toLowerCase();
  if (!DOMAIN.test(domain)) throw new Error(`--domain must be a domain name like primus.example.com (got "${opts.domain}")`);
  const out: StaffLogin[] = [];
  for (const kind of Object.keys(STAFF_KINDS) as StaffKind[]) {
    const n = opts.counts[kind] ?? 0;
    if (!Number.isInteger(n) || n < 0 || n > 99) throw new Error(`${kind}: a count from 0 to 99`);
    for (let i = 1; i <= n; i++) {
      const nn = String(i).padStart(2, "0");
      const email = `${kind}${nn}@${domain}`;
      out.push({
        kind,
        email,
        password: derivePassword(opts.secret, PASSWORD_SCOPE, email),
        role: STAFF_KINDS[kind].role,
        name: `${STAFF_KINDS[kind].label} ${nn}`,
      });
    }
  }
  if (out.length === 0) throw new Error("No logins asked for: give at least one count above 0.");
  return out;
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function staffSql(logins: readonly StaffLogin[], heading: string): string {
  const rows = JSON.stringify(logins.map(({ email, password, role, name }) => ({ email, password, role, name })));
  return `${heading}
begin;

-- The desk roles need migration ${ROLES_SCHEMA}; on an older database nothing is written.
do $guard$
begin
  if to_regprocedure('public.schema_version()') is null or public.schema_version() < '${ROLES_SCHEMA}' then
    raise exception 'Apply the migrations up to ${ROLES_SCHEMA} (staff roles) first.';
  end if;
end
$guard$;

drop table if exists pg_temp.staff_logins;
create temporary table staff_logins (email text primary key, password text not null, role text not null, name text not null);
insert into pg_temp.staff_logins
select x ->> 'email', x ->> 'password', x ->> 'role', x ->> 'name' from jsonb_array_elements(${q(rows)}::jsonb) x;

-- A login seen before is never one of the teams'.
do $teams$
declare v text;
begin
  select s.email into v
    from pg_temp.staff_logins s join auth.users u on lower(u.email) = s.email
    join public.accounts a on a.user_id = u.id
   where a.team_id is not null limit 1;
  if v is not null then
    raise exception '% is a team login: choose another --domain.', v;
  end if;
end
$teams$;

-- New logins: the auth user (bcrypt through pgcrypto, as Supabase Auth stores it) and its email identity.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, email_change, email_change_token_new, recovery_token)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', s.email,
       extensions.crypt(s.password, extensions.gen_salt('bf')), now(),
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'msim_role', s.role), '{}'::jsonb,
       now(), now(), '', '', '', ''
  from pg_temp.staff_logins s
 where not exists (select 1 from auth.users u where lower(u.email) = s.email);

-- Logins that already exist keep their id and get this file's password (re-hashed only when it changed).
update auth.users u
   set encrypted_password = extensions.crypt(s.password, extensions.gen_salt('bf')),
       raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('msim_role', s.role),
       updated_at = now()
  from pg_temp.staff_logins s
 where lower(u.email) = s.email
   and case when coalesce(u.encrypted_password, '') = '' then true
            else u.encrypted_password <> extensions.crypt(s.password, u.encrypted_password) end;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
  from pg_temp.staff_logins s join auth.users u on lower(u.email) = s.email
 where not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

-- The account: its role and the name shown in the control panel.
insert into public.accounts (user_id, role, display_name)
select u.id, s.role::public.account_role, s.name
  from pg_temp.staff_logins s join auth.users u on lower(u.email) = s.email
on conflict (user_id) do update set role = excluded.role, display_name = excluded.display_name
 where public.accounts.team_id is null;

commit;

-- Expect: ${countsLine(logins)}.
select a.role::text as role, count(*) as logins
  from pg_temp.staff_logins s join auth.users u on lower(u.email) = s.email join public.accounts a on a.user_id = u.id
 group by 1 order by 1;
`;
}

function countsLine(logins: readonly StaffLogin[]): string {
  const by = new Map<string, number>();
  for (const l of logins) by.set(l.role, (by.get(l.role) ?? 0) + 1);
  return [...by].map(([role, n]) => `${role} ${n}`).join(", ");
}

/** The private logins file: every email and password, by kind, with where to sign in. */
export function staffLoginsText(logins: readonly StaffLogin[], opts: { domain: string; appUrl: string; secretNote?: string }): string {
  const lines = [
    `PRIMUS staff logins (${opts.domain}). Private: each one signs in to the control panel.`,
    `Sign in at ${opts.appUrl.replace(/\/$/, "")}/login with Staff, the email and the password.`,
    "",
  ];
  for (const kind of Object.keys(STAFF_KINDS) as StaffKind[]) {
    const mine = logins.filter((l) => l.kind === kind);
    if (!mine.length) continue;
    lines.push(`${STAFF_KINDS[kind].label} (${STAFF_KINDS[kind].role}), ${mine.length}:`);
    for (const l of mine) lines.push(`  ${l.email.padEnd(32)} ${l.password}`);
    lines.push("");
  }
  if (opts.secretNote) lines.push(opts.secretNote, "");
  return lines.join("\n");
}
