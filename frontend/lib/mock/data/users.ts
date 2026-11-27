import type { User } from "@/lib/types";

export const CURRENT_USER_ID = "u1";
export const PARTNER_ID = "u9";

export const users: User[] = [
  { id: "u1", name: "Alex Rivera", email: "alex@acme.dev", color: "#2563eb", title: "Product Designer", status: "online", statusText: "Designing the new floor" },
  { id: "u2", name: "Priya Shah", email: "priya@acme.dev", color: "#9333ea", title: "Engineering Lead", status: "busy", statusText: "In a meeting" },
  { id: "u3", name: "Marcus Chen", email: "marcus@acme.dev", color: "#0891b2", title: "Frontend Engineer", status: "online" },
  { id: "u4", name: "Lena Novak", email: "lena@acme.dev", color: "#db2777", title: "Product Manager", status: "away", statusText: "Back at 2pm" },
  { id: "u5", name: "Diego Alvarez", email: "diego@acme.dev", color: "#16a34a", title: "Backend Engineer", status: "online" },
  { id: "u6", name: "Hana Sato", email: "hana@acme.dev", color: "#ea580c", title: "QA Engineer", status: "busy", statusText: "Focus mode" },
  { id: "u7", name: "Omar Haddad", email: "omar@acme.dev", color: "#4f46e5", title: "DevOps", status: "away" },
  { id: "u8", name: "Zoe Martin", email: "zoe@acme.dev", color: "#0d9488", title: "Marketing", status: "online" },
  { id: "u9", name: "Sam Rivera", email: "sam@home.dev", color: "#e8796b", title: "Partner", status: "online", statusText: "Making tea" },
];
