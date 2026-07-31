// Carga de los cargos recurrentes pendientes (lado server).
// Junta los datos de lib/data.ts con la derivación pura de lib/recurring.ts.

import { listServices, getRecurringContext } from "./data";
import { pendingCharges, type ServicePending } from "./recurring";
import { addCycles, todayISO } from "./utils";

export interface PendingResult {
  groups: ServicePending[];
  total: number;
  /** false = falta la migración 0004 (modo degradado) */
  migrado: boolean;
}

export async function loadPendingCharges(): Promise<PendingResult> {
  const today = todayISO();
  const desde = addCycles(today, "monthly", -12);

  const [services, ctx] = await Promise.all([listServices(), getRecurringContext(desde)]);

  const groups = pendingCharges({
    services,
    confirmados: ctx.confirmados,
    omitidos: ctx.omitidos,
    pagosSueltos: ctx.pagosSueltos,
    mesesRendidos: ctx.mesesRendidos,
    today,
    soloElPrimero: !ctx.migrado,
  });

  return {
    groups,
    total: groups.reduce((a, g) => a + g.charges.length, 0),
    migrado: ctx.migrado,
  };
}
