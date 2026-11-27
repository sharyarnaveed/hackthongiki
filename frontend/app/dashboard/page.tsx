import type { Metadata } from "next";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { BRAND } from "@/components/landing/brand";

export const metadata: Metadata = {
  title: `Dashboard — ${BRAND.name}`,
  description: `All your ${BRAND.name} workspaces.`,
  robots: { index: false },
};

export default function DashboardPage() {
  return <Dashboard />;
}
