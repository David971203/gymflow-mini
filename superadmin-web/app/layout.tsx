import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://gymflow-mini-cuba.david9712.chatgpt.site"),
  title: "GymFlow Mini | Plataforma",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: "/favicon.svg",
  },
  description: "Panel de operación para validar la digitalización de gimnasios cubanos.",
  openGraph: {
    title: "GymFlow Mini",
    description: "Miembros, planes y finanzas para gimnasios cubanos.",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "GymFlow Mini — Miembros, planes y finanzas" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "GymFlow Mini",
    description: "Miembros, planes y finanzas para gimnasios cubanos.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body className={`${geist.variable} ${mono.variable}`}>{children}</body></html>;
}
