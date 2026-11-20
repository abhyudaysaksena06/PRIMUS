import { requireStaff } from "@/lib/auth/staff";
import { StaffRoleProvider } from "./[slug]/nav";
import "./admin.css";

// The control panel: organisers, the fairness officer and the desk roles (registration, judging, crisis). Each
// section checks the role again on the server (lib/auth/staff.ts); the tabs show only the role's own sections.
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const viewer = await requireStaff("/admin");
  return <StaffRoleProvider role={viewer.role}>{children}</StaffRoleProvider>;
}
