import type { Metadata, Viewport } from "next";
import "./globals.css";
import { LanguageProvider } from "@/components/LanguageProvider";

export const metadata: Metadata = {
  title: "World Cup Predictor 2026",
  description:
    "Visualize the 2026 FIFA World Cup schedule and bracket, and predict upcoming matches with Claude.",
};

export const viewport: Viewport = {
  themeColor: "#05070e",
  width: "device-width",
  initialScale: 1,
  // Allow content to extend into the notch/home-indicator areas so we can
  // pad with env(safe-area-inset-*) where it matters (e.g. the bottom sheet).
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="absolute inset-0 bg-grid [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
          <div className="absolute -left-40 -top-40 h-[36rem] w-[36rem] rounded-full bg-pitch-500/20 blur-[120px] animate-drift" />
          <div className="absolute -right-40 top-1/3 h-[32rem] w-[32rem] rounded-full bg-neon-500/20 blur-[120px] animate-drift [animation-delay:-6s]" />
          <div className="absolute bottom-0 left-1/3 h-[28rem] w-[28rem] rounded-full bg-indigo-500/10 blur-[120px] animate-drift [animation-delay:-3s]" />
        </div>
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
