import type { Metadata, Viewport } from "next";
import "./globals.css";
import ThemeToggle from "@/components/theme-toggle";
import { THEME_BOOTSTRAP } from "@/lib/theme";
export const metadata: Metadata = {
  title: "PayAdmin · Tu tranquilidad, en números",
  description:
    "Control privado del préstamo de consolidación y presupuesto personal.",
  applicationName: "PayAdmin",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "PayAdmin" },
  icons: { icon: "/icon.svg", apple: "/apple-icon.png" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f1714",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          id="payadmin-theme"
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }}
        />
      </head>
      <body>
        <ThemeToggle />
        {children}
      </body>
    </html>
  );
}
