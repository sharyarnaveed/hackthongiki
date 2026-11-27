import type { Metadata } from "next";
import { Inter, Press_Start_2P } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/shell/ThemeProvider";
import { TitleBar } from "@/components/shell/TitleBar";
import { Toaster } from "@/components/common/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { themeInitScript } from "@/components/shell/theme-script";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const pixel = Press_Start_2P({ variable: "--font-press-start", weight: "400", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Virtual Office",
  description: "A virtual office for remote teams, and a cozy pixel home for couples.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-mode="office"
      suppressHydrationWarning
      className={`${inter.variable} ${pixel.variable} antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex h-screen flex-col">
        <ThemeProvider>
          <TooltipProvider delayDuration={300}>
            <TitleBar />
            <main className="relative min-h-0 flex-1 overflow-hidden">{children}</main>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
