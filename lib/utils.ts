import type { CurrencyCode } from "./types";

// Zona horaria de la oficina. En Vercel el server corre en UTC: después de las
// 21:00 de Argentina `new Date()` ya devuelve el día siguiente. Como de esto
// depende la fecha con la que se crean los pagos, "hoy" tiene que calcularse
// siempre en hora local argentina.
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

// Un instante (ej: presentada_at) llevado al día calendario argentino
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

// Mes (YYYY-MM) al que pertenece una fecha
export const monthOf = (date: string): string => date.slice(0, 7);

// Nombre legible de un mes: "julio de 2026"
export function monthLabel(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(
    new Date(y, m - 1, 1)
  );
}

// Corre un mes (YYYY-MM) n posiciones. Se hace con aritmética entera y no con
// Date.setMonth(), que desborda: sobre un 31 devuelve el mes siguiente.
export function shiftMonth(mes: string, delta: number): string {
  const [y, m] = mes.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

// Mes anterior a uno dado (YYYY-MM)
export const prevMonth = (mes: string): string => shiftMonth(mes, -1);

// Cuántos meses hay entre dos meses (YYYY-MM)
export function monthsBetween(desde: string, hasta: string): number {
  const [yd, md] = desde.split("-").map(Number);
  const [yh, mh] = hasta.split("-").map(Number);
  return (yh * 12 + mh) - (yd * 12 + md);
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

// Meses en español, para reconocerlos dentro de una descripción
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const capitalizarComo = (modelo: string, texto: string) =>
  modelo[0] === modelo[0]?.toUpperCase() ? texto[0].toUpperCase() + texto.slice(1) : texto;

/**
 * Al repetir un gasto, corre el período que trae la descripción.
 *
 * Las descripciones suelen llevar el mes ("Cursor Pro — Julio 2026"). Copiarla
 * tal cual en agosto deja un pago que dice julio, y eso después se rinde así.
 * Solo se toca si el período que aparece es EXACTAMENTE el del pago original:
 * cualquier otro texto con un mes adentro se deja quieto.
 */
export function correrPeriodoEnDescripcion(
  descripcion: string | null,
  fechaOriginal: string,
  fechaNueva: string
): string | null {
  if (!descripcion) return descripcion;

  const [yViejo, mViejo] = [fechaOriginal.slice(0, 4), Number(fechaOriginal.slice(5, 7))];
  const [yNuevo, mNuevo] = [fechaNueva.slice(0, 4), Number(fechaNueva.slice(5, 7))];
  if (yViejo === yNuevo && mViejo === mNuevo) return descripcion;

  const nombreViejo = MESES[mViejo - 1];
  const nombreNuevo = MESES[mNuevo - 1];

  // "julio 2026" / "julio de 2026" -> mes y año nuevos
  const conAnio = new RegExp(String.raw`\b(${nombreViejo})(\s+(?:de\s+)?)(${yViejo})\b`, "i");
  if (conAnio.test(descripcion)) {
    return descripcion.replace(conAnio, (_m, mes: string, medio: string) =>
      `${capitalizarComo(mes, nombreNuevo)}${medio}${yNuevo}`
    );
  }

  // "07/2026" o "2026-07"
  const mm = String(mViejo).padStart(2, "0");
  const nuevoMM = String(mNuevo).padStart(2, "0");
  const barra = new RegExp(String.raw`\b${mm}/${yViejo}\b`);
  if (barra.test(descripcion)) return descripcion.replace(barra, `${nuevoMM}/${yNuevo}`);
  const guion = new RegExp(String.raw`\b${yViejo}-${mm}\b`);
  if (guion.test(descripcion)) return descripcion.replace(guion, `${yNuevo}-${nuevoMM}`);

  // Solo el nombre del mes, sin año ("Cursor Pro — Julio")
  const soloMes = new RegExp(String.raw`\b(${nombreViejo})\b`, "i");
  if (soloMes.test(descripcion)) {
    return descripcion.replace(soloMes, (mes: string) => capitalizarComo(mes, nombreNuevo));
  }

  return descripcion;
}

/**
 * Identidad de un gasto que se repite mes a mes, para poder preguntar "¿esto ya
 * lo cargué este mes?".
 *
 * Se ignora el período que traiga la descripción: "Cursor Pro — Julio 2026" y
 * "Cursor Pro — Agosto 2026" son el MISMO gasto en meses distintos. Sin esto,
 * repetir un gasto (que corre el mes en la descripción) haría que el sistema no
 * lo reconozca y lo siga sugiriendo como pendiente de cargar.
 */
export function claveDeGasto(p: {
  provider: string | null;
  description: string | null;
  service_id?: string | null;
  service?: { name: string } | null;
}): string {
  const base = (p.description ?? p.service?.name ?? "").toLowerCase();
  const sinPeriodo = base
    .replace(new RegExp(String.raw`\b\d{1,2}[/-]\d{4}\b`, "g"), " ")
    .replace(new RegExp(String.raw`\b\d{4}[/-]\d{1,2}\b`, "g"), " ")
    .replace(new RegExp(String.raw`\b(${MESES.join("|")})\b`, "g"), " ")
    .replace(new RegExp(String.raw`\b\d{4}\b`, "g"), " ")
    .replace(new RegExp(String.raw`[^\p{L}\p{N}]+`, "gu"), " ")
    .trim();
  return `${(p.provider ?? "").toLowerCase().trim()}|${p.service_id ?? ""}|${sinPeriodo}`;
}
