import { api } from "@/lib/mock";

export function generateStaticParams() {
  return api.office.staticWorkspaceIds().map((workspaceId) => ({ workspaceId }));
}

export default function WorkspaceLayout({ children }: LayoutProps<"/office/[workspaceId]">) {
  return <>{children}</>;
}
