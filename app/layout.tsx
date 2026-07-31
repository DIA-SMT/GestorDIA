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

// Se corre ANTES del primer pintado: deja el sidebar en el estado que el
// usuario eligió sin que se vea abrir y cerrar en cada navegación. Va inline
// (y no con cookies) para no volver dinámico todo el segmento del dashboard.
const SIDEBAR_INIT = `
try {
  if (localStorage.getItem('gestordia:sidebar') === 'collapsed') {
    document.documentElement.dataset.sidebar = 'collapsed';
  }
} catch (e) {}
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // suppressHydrationWarning: el script de arriba agrega data-sidebar antes de
  // que React hidrate, así que los atributos del <html> del server nunca van a
  // coincidir con los del cliente. Solo afecta a este elemento.
  return (
    <html lang="es" className={poppins.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT }} />
      </head>
      <body>
        <LiquidBackground />
        {children}
      </body>
    </html>
  );
}
