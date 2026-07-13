import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";
import LiquidBackground from "@/components/liquid-bg";

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "gestorDIA — Pagos y rendición",
  description:
    "Registro y seguimiento de pagos con tarjeta (credenciales, suscripciones, servicios) con soporte para rendición de cuentas.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${display.variable} ${body.variable}`}>
      <body>
        <LiquidBackground />
        {children}
      </body>
    </html>
  );
}
