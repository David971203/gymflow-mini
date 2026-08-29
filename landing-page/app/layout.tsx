import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gymflowmini.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "GymFlow Mini | Tu gimnasio, bajo control",
  description: "Administra miembros, membresías, planes, cobros y vencimientos desde una aplicación simple creada para gimnasios cubanos.",
  icons: { icon: "/icon.png", apple: "/icon.png" },
  openGraph: {
    title: "GymFlow Mini | Tu gimnasio, bajo control",
    description: "Menos papeleo. Más tiempo para hacer crecer tu comunidad.",
    url: siteUrl,
    siteName: "GymFlow Mini",
    locale: "es_CU",
    type: "website",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "GymFlow Mini" }],
  },
  twitter: { card: "summary_large_image", title: "GymFlow Mini", description: "Tu gimnasio, bajo control.", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body className={geist.variable}>{children}</body></html>;
}
