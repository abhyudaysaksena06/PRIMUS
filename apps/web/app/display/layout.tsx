import { requireRole } from "@/lib/auth/viewer";
import "../demo/demo.css";
import "../demo/event-news-ticker.css";
import "./display.css";

export default async function DisplayLayout({ children }: LayoutProps<"/display">) {
  await requireRole(["DISPLAY", "ORGANISER", "FAIRNESS"], "/display");
  return children;
}
