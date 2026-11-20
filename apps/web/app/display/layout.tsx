import { requireRole } from "@/lib/auth/viewer";
import "./display.css";

export default async function DisplayLayout({ children }: LayoutProps<"/display">) {
  await requireRole(["DISPLAY", "ORGANISER", "FAIRNESS"], "/display");
  return children;
}
