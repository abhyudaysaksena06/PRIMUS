import { requireRole } from "@/lib/auth/viewer";
import "@/styles/primus/demo.css";
import "@/styles/primus/event-news-ticker.css";
import "./display.css";

export default async function DisplayLayout({ children }: LayoutProps<"/display">) {
  await requireRole(["DISPLAY", "ORGANISER", "FAIRNESS"], "/display");
  return children;
}
