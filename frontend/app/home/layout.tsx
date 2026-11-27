import { ModeScope } from "@/components/shell/ModeScope";

export default function Layout({ children }: LayoutProps<"/home">) {
  return <ModeScope mode="home">{children}</ModeScope>;
}
