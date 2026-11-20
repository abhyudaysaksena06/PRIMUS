// Server-side role check for this section (lib/auth/staff.ts): organisers only (ORGANISER_SECTIONS in
// lib/auth/routes.ts); the database refuses everyone else too (staff_activity, migration 100).
import { sectionGate } from "@/lib/auth/staff";

export default sectionGate("/activity");
