import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import LiquidBackground from "@/components/liquid-bg";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "gestorDIA — Pagos y rendición | Dirección de IA",
  description:
    "Registro y seguimiento de pagos con tarjeta (credenciales, suscripciones, servicios) con soporte para rendición de cuentas. Dirección de Inteligencia Artificial · Municipalidad de San Miguel de Tucumán.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={poppins.variable}>
      <body>
        <LiquidBackground />
        {children}
      </body>
    </html>
  );
}
