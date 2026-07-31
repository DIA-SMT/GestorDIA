"use server";

// Acciones sobre los cargos recurrentes propuestos.
//
// El cargo propuesto no existe en la base: se deriva del ancla del servicio
// (ver lib/recurring.ts). Estas acciones son las ÚNICAS que mueven esa ancla.
// Ninguna se dispara sola al renderizar: siempre las aprieta el usuario.

import { revalidatePath } from "next/cache";
import {
  getCurrentUser,
  getService,
  getRecurringContext,
  lastPaymentForService,
  advanceServiceRenewal,
  createCyclePayment,
  recordCycleSkip,
  setServiceStatus,
  type PaymentInput,
} from "@/lib/data";
import { addCycles, anchorDayOf, periodLabel, todayISO, isRecurring } from "@/lib/utils";
import type { Service } from "@/lib/types";

export interface CargoResult {
  ok: boolean;
  message: string;
  paymentId?: string;
}

function refrescar() {
  revalidatePath("/");
  revalidatePath("/rendicion");
  revalidatePath("/servicios");
  revalidatePath("/pagos");
}

/**
 * Nueva posición del ancla: se corre hacia adelante mientras los ciclos que va
 * pisando ya estén resueltos (confirmados u omitidos). Así confirmar un ciclo
 * fuera de orden no "saltea" los anteriores, que siguen pendientes.
 */
/**
 * Todo lo que ya está resuelto para el servicio: confirmado U omitido, más el
 * ciclo que se está resolviendo en este momento. Es un helper único a propósito
 * — cuando confirmar y omitir armaban este set por su cuenta, confirmar se
 * olvidaba de los omitidos y el ancla se clavaba sobre un ciclo omitido.
 */
function resueltosCon(ctx: { confirmados: Set<string>; omitidos: Set<string> }, key: string): Set<string> {
  const out = new Set([...ctx.confirmados, ...ctx.omitidos]);
  out.add(key);
  return out;
}

function anclaSiguiente(s: Service, resueltos: Set<string>): string | null {
  if (!s.next_renewal_date) return null;
  if (!isRecurring(s.billing_cycle)) return null; // one_time: se termina acá

  const anchorDay = anchorDayOf(s);
  const base = s.next_renewal_date;
  let n = 0;
  let d = base;
  while (resueltos.has(`${s.id}|${d}`) && n < 5000) {
    n++;
    d = addCycles(base, s.billing_cycle, n, anchorDay);
  }
  return d;
}

// ---------------------------------------------------------------------------
// Confirmar: el gasto ocurrió -> se crea el pago del período
// ---------------------------------------------------------------------------
export async function confirmarCargo(
  serviceId: string,
  cycleDate: string,
  override?: { amount?: number; exchangeRate?: number | null }
): Promise<CargoResult> {
  const user = await getCurrentUser();
  const s = await getService(serviceId);
  if (!s) return { ok: false, message: "No encontré el servicio." };
  if (s.status !== "active") return { ok: false, message: `"${s.name}" ya no está activo.` };
  if (!s.next_renewal_date) return { ok: false, message: `"${s.name}" no tiene fecha de cobro.` };

  // Se re-deriva contra la base: nunca se confía en lo que mandó el navegador.
  const ctx = await getRecurringContext(addCycles(todayISO(), "monthly", -12));
  const key = `${serviceId}|${cycleDate}`;
  if (ctx.confirmados.has(key)) return { ok: false, message: "Ese cargo ya estaba confirmado." };
  if (ctx.omitidos.has(key)) return { ok: false, message: "Ese cargo estaba omitido." };
  if (cycleDate < s.next_renewal_date) {
    return { ok: false, message: "Ese ciclo ya se había resuelto. Actualizá la página." };
  }

  const monto = override?.amount != null && override.amount > 0 ? override.amount : s.expected_amount;
  if (monto == null || monto <= 0) {
    return { ok: false, message: `"${s.name}" no tiene monto estimado. Cargalo en el servicio o registrá el pago a mano.` };
  }

  // Datos de rendición heredados del último pago del servicio: sin esto la
  // rendición sale con proveedor vacío y "sin comprobante", y hay que editar
  // pago por pago antes de mandársela al contador.
  const previo = await lastPaymentForService(serviceId);
  const cotizacion =
    override?.exchangeRate != null
      ? override.exchangeRate
      : s.currency === "ARS"
      ? null
      : previo?.exchange_rate ?? null;

  const input: PaymentInput = {
    service_id: s.id,
    category_id: s.category_id,
    description: `${s.name} — ${periodLabel(cycleDate, s.billing_cycle)}`,
    amount: monto,
    currency: s.currency,
    exchange_rate: s.currency === "ARS" ? null : cotizacion,
    amount_ars: s.currency === "ARS" ? monto : cotizacion != null ? Math.round(monto * cotizacion * 100) / 100 : null,
    // La fecha del CICLO, no la de hoy: si en agosto confirmás mayo, junio y
    // julio, cada gasto tiene que caer en la rendición de su mes.
    payment_date: cycleDate,
    payment_url: s.url,
    status: "paid",
    payment_method: previo?.payment_method ?? "Tarjeta principal",
    provider: previo?.provider ?? null,
    provider_tax_id: previo?.provider_tax_id ?? null,
    receipt_type: previo?.receipt_type ?? "sin_comprobante",
    receipt_number: null, // el número nunca se hereda: es único por comprobante
    notes: null,
  };

  const res = await createCyclePayment(input, cycleDate, user?.id ?? null);
  if (res.duplicate) return { ok: false, message: "Ese cargo ya estaba confirmado." };
  if (res.error || !res.id) return { ok: false, message: res.error ?? "No se pudo crear el pago." };

  // Recién con el pago creado se mueve el ancla. Si el compare-and-swap falla
  // (otro la movió) no pasa nada grave: el pago ya tiene su cycle_date y el
  // cargo no vuelve a proponerse.
  await advanceServiceRenewal(s.id, s.next_renewal_date, anclaSiguiente(s, resueltosCon(ctx, key)));

  refrescar();
  const falta = cotizacion == null && s.currency !== "ARS";
  return {
    ok: true,
    paymentId: res.id,
    message: `Listo: ${s.name} — ${periodLabel(cycleDate, s.billing_cycle)}.${
      falta ? " Cargale la cotización para que sume en el total en pesos." : ""
    }`,
  };
}

// ---------------------------------------------------------------------------
// Omitir: este mes no se cobró (o no corresponde), pero el servicio sigue
// ---------------------------------------------------------------------------
export async function omitirCargo(
  serviceId: string,
  cycleDate: string,
  reason?: string
): Promise<CargoResult> {
  const user = await getCurrentUser();
  const s = await getService(serviceId);
  if (!s || !s.next_renewal_date) return { ok: false, message: "No encontré el servicio." };

  await recordCycleSkip(serviceId, cycleDate, reason ?? null, user?.id ?? null);

  const ctx = await getRecurringContext(addCycles(todayISO(), "monthly", -12));
  const resueltos = resueltosCon(ctx, `${serviceId}|${cycleDate}`);
  await advanceServiceRenewal(s.id, s.next_renewal_date, anclaSiguiente(s, resueltos));

  refrescar();
  return { ok: true, message: `Omitido: ${s.name} — ${periodLabel(cycleDate, s.billing_cycle)}.` };
}

// ---------------------------------------------------------------------------
// Dar de baja: el servicio ya no se usa, deja de proponer cargos
// ---------------------------------------------------------------------------
export async function darDeBajaServicio(serviceId: string): Promise<CargoResult> {
  const s = await getService(serviceId);
  if (!s) return { ok: false, message: "No encontré el servicio." };
  const r = await setServiceStatus(serviceId, "cancelled");
  if (r.error) return { ok: false, message: r.error };
  refrescar();
  return { ok: true, message: `"${s.name}" quedó dado de baja: no vuelve a proponer cargos.` };
}

// ---------------------------------------------------------------------------
// Poner al día: saltear todos los ciclos viejos SIN crear pagos
// (para cuando el ancla quedó vieja y esos gastos ya se cargaron a mano)
// ---------------------------------------------------------------------------
export async function ponerAlDia(serviceId: string): Promise<CargoResult> {
  const s = await getService(serviceId);
  if (!s || !s.next_renewal_date) return { ok: false, message: "No encontré el servicio." };
  if (!isRecurring(s.billing_cycle)) return { ok: false, message: "Ese servicio no es recurrente." };

  const today = todayISO();
  const anchorDay = anchorDayOf(s);
  let n = 0;
  let d = s.next_renewal_date;
  while (d <= today && n < 5000) {
    n++;
    d = addCycles(s.next_renewal_date, s.billing_cycle, n, anchorDay);
  }
  const ok = await advanceServiceRenewal(s.id, s.next_renewal_date, d);
  if (!ok) return { ok: false, message: "La fecha cambió mientras tanto. Actualizá la página." };

  refrescar();
  return { ok: true, message: `"${s.name}" quedó al día. Próximo cobro: ${d}.` };
}
