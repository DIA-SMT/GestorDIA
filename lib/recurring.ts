// Cargos recurrentes por confirmar.
//
// IDEA CENTRAL: un cargo pendiente NO se guarda en la base. Se DERIVA de
// `services.next_renewal_date`, que funciona como marca de agua: todo ciclo
// anterior a esa fecha ya está resuelto (confirmado, omitido o puesto al día).
//
// Por qué no vive en `payments` con un estado tipo "previsto": la rendición
// (listPaymentsBetween en lib/data.ts) NO filtra por estado, la selección de
// /rendicion filtra solo por `rendido_at`, y RendicionPdfRow no tiene columna
// Estado. Un cargo apenas "previsto" saldría IMPRESO al contador como un gasto
// real y sumaría en el total, sin que nada lo delate. Por eso una fila de
// `payments` solo existe cuando el usuario confirmó que el gasto ocurrió.
//
// Este archivo es PURO: no toca la base ni el reloj. Recibe todo por parámetro
// para que el resultado sea reproducible.

import type { CurrencyCode, Service } from "./types";
import { addCycles, anchorDayOf, isRecurring, monthOf, periodLabel } from "./utils";

// Tope de ciclos que se proponen por servicio. Si un ancla quedó muy vieja,
// mostrar 40 filas es inusable: se corta y se ofrece "poner al día".
const MAX_CICLOS = 12;
// No se proponen cargos anteriores a esta ventana (un ancla olvidada de 2019
// no debería generar 80 gastos).
const MAX_MESES_ATRAS = 12;
// Ventana para considerar que un pago cargado a mano ya cubre este ciclo.
const DIAS_TOLERANCIA = 7;

export interface ChargeDuplicate {
  paymentId: string;
  date: string;
  amount: number;
  currency: CurrencyCode;
}

export interface PendingCharge {
  /** serviceId + cycleDate. Identifica el cargo de punta a punta. */
  key: string;
  serviceId: string;
  serviceName: string;
  serviceUrl: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  /** Fecha del ciclo. Es la que va como payment_date, NO "hoy". */
  cycleDate: string;
  /** "julio 2026" */
  periodo: string;
  amount: number | null;
  currency: CurrencyCode;
  /** true = débito automático (ya se cobró); false = manual (hay que pagarlo) */
  auto: boolean;
  /** Días desde la fecha del ciclo (0 = hoy) */
  overdueDays: number;
  /** Ya hay un pago suelto de este servicio que parece cubrir el ciclo */
  duplicate: ChargeDuplicate | null;
  /** El mes de este cargo ya tiene pagos rendidos al contador */
  mesYaRendido: boolean;
  /** El primer ciclo del servicio que sigue pendiente (para el "poner al día") */
  esElPrimero: boolean;
}

export interface ServicePending {
  serviceId: string;
  serviceName: string;
  charges: PendingCharge[];
  /** Se cortó por el tope: hay más ciclos atrasados de los que se muestran */
  truncated: boolean;
  /** Primer ciclo futuro, adonde salta el ancla si "ponen al día" */
  catchUpTo: string | null;
}

export interface PendingInput {
  services: Service[];
  /** "serviceId|cycleDate" de los ciclos que ya tienen pago confirmado */
  confirmados: Set<string>;
  /** "serviceId|cycleDate" de los ciclos omitidos a propósito */
  omitidos: Set<string>;
  /** Pagos del servicio sin cycle_date (cargados a mano), para detectar duplicados */
  pagosSueltos: { id: string; service_id: string; payment_date: string; amount: number; currency: CurrencyCode }[];
  /** Meses (YYYY-MM) que ya tienen al menos un pago rendido */
  mesesRendidos: Set<string>;
  /** Día de hoy en Argentina (YYYY-MM-DD) */
  today: string;
  /**
   * Modo degradado (falta la migración 0004): sin `payments.cycle_date` el
   * único registro de lo confirmado es el ancla, así que solo se puede resolver
   * un ciclo por vez y en orden. Se muestra únicamente el más viejo.
   */
  soloElPrimero?: boolean;
}

const diffDays = (from: string, to: string) =>
  Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);

const shiftDays = (iso: string, days: number) =>
  new Date(Date.parse(iso + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);

/**
 * Un servicio propone cargos si está activo, tiene fecha de cobro y su ciclo
 * se repite solo. `on_demand` (créditos) y `custom` nunca proponen: no tienen
 * período definido. `one_time` propone una sola vez.
 */
export function proponeCargos(s: Service): boolean {
  if (s.status !== "active") return false;
  if (!s.next_renewal_date) return false;
  return isRecurring(s.billing_cycle) || s.billing_cycle === "one_time";
}

export function pendingCharges(input: PendingInput): ServicePending[] {
  const { services, confirmados, omitidos, pagosSueltos, mesesRendidos, today } = input;

  // Pagos sueltos por servicio, ordenados por fecha. Se van consumiendo: un
  // mismo pago no puede "cubrir" dos ciclos distintos.
  const sueltosPorServicio = new Map<string, typeof pagosSueltos>();
  for (const p of pagosSueltos) {
    const arr = sueltosPorServicio.get(p.service_id) ?? [];
    arr.push(p);
    sueltosPorServicio.set(p.service_id, arr);
  }
  for (const arr of sueltosPorServicio.values()) {
    arr.sort((a, b) => a.payment_date.localeCompare(b.payment_date));
  }

  const piso = addCycles(today, "monthly", -MAX_MESES_ATRAS);
  const out: ServicePending[] = [];

  for (const s of services) {
    if (!proponeCargos(s)) continue;

    const ancla = s.next_renewal_date!;
    const anchorDay = anchorDayOf(s);
    const cycle = s.billing_cycle;
    const usados = new Set<string>();
    const charges: PendingCharge[] = [];
    let truncated = false;
    let catchUpTo: string | null = null;

    // Ciclos desde el ancla hasta hoy inclusive. Siempre con índice n desde el
    // ancla, nunca encadenando (ver el comentario de addCycles en utils.ts).
    const fechas: string[] = [];
    if (cycle === "one_time") {
      if (ancla <= today) fechas.push(ancla);
    } else {
      for (let n = 0; n < 5000; n++) {
        const d = addCycles(ancla, cycle, n, anchorDay);
        if (d > today) {
          catchUpTo = d;
          break;
        }
        if (d >= piso) fechas.push(d);
        // Un ciclo anterior al piso NO se propone, pero tampoco se resuelve
        // solo: hay que marcar truncated para que aparezca "Poner al día".
        // Si no, el ancla queda congelada en un ciclo viejo, invisible y sin
        // ninguna forma de avanzarla desde la pantalla.
        else truncated = true;
        if (fechas.length > MAX_CICLOS) {
          truncated = true;
          fechas.length = MAX_CICLOS;
          // catchUpTo se resuelve abajo: el primer ciclo futuro de verdad
          for (let k = n; k < 5000; k++) {
            const f = addCycles(ancla, cycle, k, anchorDay);
            if (f > today) {
              catchUpTo = f;
              break;
            }
          }
          break;
        }
      }
    }

    for (const [i, cycleDate] of fechas.entries()) {
      const key = `${s.id}|${cycleDate}`;
      if (confirmados.has(key) || omitidos.has(key)) continue;

      // ¿Hay un pago suelto que parezca ser este cargo, cargado a mano?
      const desde = shiftDays(cycleDate, -DIAS_TOLERANCIA);
      const hasta = cycle === "one_time" ? shiftDays(cycleDate, 60) : addCycles(cycleDate, cycle, 1, anchorDay);
      const candidato = (sueltosPorServicio.get(s.id) ?? []).find(
        (p) => !usados.has(p.id) && p.payment_date >= desde && p.payment_date < hasta
      );
      if (candidato) usados.add(candidato.id);

      charges.push({
        key,
        serviceId: s.id,
        serviceName: s.name,
        serviceUrl: s.url,
        categoryName: s.category?.name ?? null,
        categoryColor: s.category?.color ?? null,
        cycleDate,
        periodo: periodLabel(cycleDate, cycle),
        amount: s.expected_amount,
        currency: s.currency,
        auto: s.payment_mode !== "manual",
        overdueDays: diffDays(cycleDate, today),
        duplicate: candidato
          ? {
              paymentId: candidato.id,
              date: candidato.payment_date,
              amount: Number(candidato.amount),
              currency: candidato.currency,
            }
          : null,
        mesYaRendido: mesesRendidos.has(monthOf(cycleDate)),
        esElPrimero: i === 0,
      });
    }

    const visibles = input.soloElPrimero ? charges.slice(0, 1) : charges;
    const recortado = truncated || visibles.length < charges.length;
    // Se incluye el grupo aunque no tenga cargos visibles si quedó algo
    // recortado: si no, un ancla muy vieja (todos sus ciclos por debajo del
    // piso) no mostraría nada y no habría forma de ponerla al día.
    if (visibles.length > 0 || recortado) {
      out.push({
        serviceId: s.id,
        serviceName: s.name,
        charges: visibles,
        truncated: recortado,
        catchUpTo,
      });
    }
  }

  return out;
}

/** Todos los cargos de todos los servicios, en orden cronológico. */
export function flattenPending(groups: ServicePending[]): PendingCharge[] {
  return groups
    .flatMap((g) => g.charges)
    .sort((a, b) => a.cycleDate.localeCompare(b.cycleDate) || a.serviceName.localeCompare(b.serviceName));
}
