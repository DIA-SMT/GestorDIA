import type { CurrencyCode } from "./types";

// Formateo de moneda
export function formatMoney(
  amount: number | null | undefined,
  currency: CurrencyCode = "ARS"
): string {
  if (amount == null) return "—";
  const locale = currency === "USD" ? "en-US" : "es-AR";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Fecha corta legible (dd/mm/aaaa)
export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date + (date.length === 10 ? "T00:00:00" : ""));
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

// Días hasta una fecha (negativo = vencido)
export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const target = new Date(date + "T00:00:00").getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / (1000 * 60 * 60 * 24));
}

// Equivalente en ARS de un pago
export function toARS(
  amount: number,
  currency: CurrencyCode,
  exchangeRate: number | null
): number | null {
  if (currency === "ARS") return amount;
  if (exchangeRate == null) return null;
  return amount * exchangeRate;
}
