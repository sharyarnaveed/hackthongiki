import { ModeScope } from "@/components/shell/ModeScope";

export default function Layout({ children }: LayoutProps<"/office">) {
  return <ModeScope mode="office">{children}</ModeScope>;
}
