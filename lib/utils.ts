import type { BillingCycle, CurrencyCode, PaymentMode } from "./types";

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

// Adelanta una fecha de renovación al próximo vencimiento hoy-o-futuro según el
// ciclo. Si la fecha guardada ya pasó y el ciclo es recurrente, la suma de a un
// ciclo hasta que sea hoy o futura (el cobro anterior ya ocurrió). Los ciclos no
// recurrentes (único, a demanda, personalizado) se devuelven sin cambios.
export function upcomingRenewal(
  date: string | null | undefined,
  cycle: BillingCycle
): string | null {
  if (!date) return null;
  if (cycle === "one_time" || cycle === "on_demand" || cycle === "custom") return date;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(date + "T00:00:00");

  let guard = 0;
  while (d.getTime() < today.getTime() && guard < 5000) {
    if (cycle === "weekly") d.setDate(d.getDate() + 7);
    else if (cycle === "monthly") d.setMonth(d.getMonth() + 1);
    else if (cycle === "quarterly") d.setMonth(d.getMonth() + 3);
    else if (cycle === "yearly") d.setFullYear(d.getFullYear() + 1);
    else break;
    guard++;
  }

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Próxima fecha de cobro "efectiva" de un servicio, para alertas y vistas:
// - Débito automático recurrente: se adelanta al próximo cobro futuro (ya se debitó).
// - Pago manual: se deja la fecha original (si venció, sigue siendo alerta de acción).
export function effectiveRenewal(
  date: string | null | undefined,
  cycle: BillingCycle,
  mode: PaymentMode
): string | null {
  if (mode === "manual") return date ?? null;
  return upcomingRenewal(date, cycle);
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
