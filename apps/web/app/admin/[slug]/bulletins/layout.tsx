// Server-side role check for this section (lib/auth/staff.ts, migration 074).
import { sectionGate } from "@/lib/auth/staff";

export default sectionGate("/bulletins");
