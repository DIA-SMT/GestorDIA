import type { BillingCycle, CurrencyCode, PaymentMode, Service } from "./types";

// Zona horaria de la oficina. En Vercel el server corre en UTC: después de las
// 21:00 de Argentina `new Date()` ya devuelve el día siguiente. Como de estas
// fechas dependen los cargos que se proponen y la fecha con la que se crean los
// pagos, "hoy" tiene que calcularse siempre en hora local argentina.
export const TZ = "America/Argentina/Buenos_Aires";

// "Hoy" en Argentina, como YYYY-MM-DD ("en-CA" formatea justo así)
export function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Un instante (ej: rendido_at) llevado al día calendario argentino
export function toLocalDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

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

// Días hasta una fecha (negativo = vencido). Se compara contra el día
// calendario argentino, no contra la hora del server.
export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const target = Date.parse(date + "T00:00:00Z");
  const today = Date.parse(todayISO() + "T00:00:00Z");
  if (Number.isNaN(target)) return null;
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Aritmética de ciclos de facturación
// ---------------------------------------------------------------------------
// Se hace con strings, sin objetos Date, porque `Date.setMonth()` desborda:
// new Date("2026-01-31").setMonth(+1) devuelve el 3 de MARZO, y encadenando eso
// un servicio que cobra el 31 termina cobrando el día 3 para siempre. Lo mismo
// con setFullYear() sobre un 29 de febrero.
//
// La clave es `anchorDay`: el día "real" de cobro (12, 28, 31…). Cuando un mes
// no llega a ese día se recorta (31 -> 28 en febrero) pero el ancla NO se pierde,
// así el mes siguiente vuelve a su día natural.

const MONTHS_PER_CYCLE: Partial<Record<BillingCycle, number>> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

// Ciclos que se repiten solos y por lo tanto pueden proponer un cargo nuevo
export function isRecurring(cycle: BillingCycle): boolean {
  return cycle === "monthly" || cycle === "quarterly" || cycle === "yearly" || cycle === "weekly";
}

function lastDayOfMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

const fmt = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// Día de cobro de un servicio: la columna dedicada si existe (puede no estar si
// todavía no corrieron la migración 0004), si no el día de la fecha guardada.
export function anchorDayOf(s: Pick<Service, "billing_anchor_day" | "next_renewal_date">): number | undefined {
  const stored = s.billing_anchor_day;
  if (typeof stored === "number" && stored >= 1 && stored <= 31) return stored;
  if (s.next_renewal_date) return Number(s.next_renewal_date.slice(8, 10)) || undefined;
  return undefined;
}

// Suma n ciclos a una fecha. n puede ser 0 (devuelve la fecha recortada al mes).
export function addCycles(
  date: string,
  cycle: BillingCycle,
  n: number,
  anchorDay?: number
): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));

  if (cycle === "weekly") {
    const t = Date.parse(date + "T00:00:00Z") + n * 7 * 86400000;
    const nd = new Date(t);
    return fmt(nd.getUTCFullYear(), nd.getUTCMonth() + 1, nd.getUTCDate());
  }

  const step = MONTHS_PER_CYCLE[cycle];
  if (!step) return date; // one_time / on_demand / custom: no avanzan

  const total = (y * 12 + (m - 1)) + n * step;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const want = anchorDay ?? d;
  return fmt(ty, tm, Math.min(want, lastDayOfMonth(ty, tm)));
}

// Suma exactamente un ciclo (para calcular la próxima renovación después de
// pagar la actual). Ciclos no recurrentes devuelven null.
export function nextCycleDate(
  date: string | null | undefined,
  cycle: BillingCycle,
  anchorDay?: number
): string | null {
  if (!date) return null;
  if (!isRecurring(cycle)) return null;
  return addCycles(date, cycle, 1, anchorDay);
}

// Adelanta una fecha de renovación al próximo vencimiento hoy-o-futuro según el
// ciclo. Los ciclos no recurrentes (único, a demanda, personalizado) se
// devuelven sin cambios.
export function upcomingRenewal(
  date: string | null | undefined,
  cycle: BillingCycle,
  anchorDay?: number
): string | null {
  if (!date) return null;
  if (!isRecurring(cycle)) return date;

  const today = todayISO();
  // Se calcula siempre con índice n desde el ancla, nunca encadenando la
  // función sobre su propio resultado (eso es lo que corrompía el día de cobro).
  let n = 0;
  let out = date;
  while (out < today && n < 5000) {
    n++;
    out = addCycles(date, cycle, n, anchorDay);
  }
  return out;
}

// Próxima fecha de cobro "efectiva" de un servicio, para alertas y vistas:
// - Débito automático recurrente: se adelanta al próximo cobro futuro (ya se debitó).
// - Pago manual: se deja la fecha original (si venció, sigue siendo alerta de acción).
//
// OJO: esto es solo para MOSTRAR "cuándo es el próximo cobro". Los ciclos que
// quedaron atrás sin registrarse no desaparecen: los levanta pendingCharges()
// en lib/recurring.ts como cargos por confirmar.
export function effectiveRenewal(
  date: string | null | undefined,
  cycle: BillingCycle,
  mode: PaymentMode,
  anchorDay?: number
): string | null {
  if (mode === "manual") return date ?? null;
  return upcomingRenewal(date, cycle, anchorDay);
}

// Etiqueta del período que cubre un cargo, para la descripción del pago.
// Mensual/trimestral -> "julio 2026"; anual -> "2026"; semanal -> "semana del 12/07".
export function periodLabel(cycleDate: string, cycle: BillingCycle): string {
  const y = Number(cycleDate.slice(0, 4));
  const m = Number(cycleDate.slice(5, 7));
  if (cycle === "yearly") return String(y);
  if (cycle === "weekly") return `semana del ${formatDate(cycleDate)}`;
  const nombre = new Intl.DateTimeFormat("es-AR", { month: "long" }).format(new Date(y, m - 1, 1));
  return `${nombre} ${y}`;
}

// Mes (YYYY-MM) al que pertenece una fecha
export const monthOf = (date: string): string => date.slice(0, 7);

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
