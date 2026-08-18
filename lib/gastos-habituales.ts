// ¿Qué gastos que venís pagando todavía no cargaste este mes?
//
// Reemplaza al motor de cargos recurrentes, con una diferencia de fondo: no
// PROPONE un monto estimado (que cambiaba todos los meses y siempre estaba mal),
// sino que muestra lo que realmente se pagó la última vez y deja que el usuario
// cargue el número real.
//
// Mira una ventana de varios meses y no solo el anterior. Un mes que se salteó
// la carga, un servicio bimestral o un gasto que se viene arrastrando sin
// registrar desaparecerían de la vista si la comparación fuera contra el mes
// pasado nomás — que es justo cuando más falta hace el recordatorio.
//
// Módulo puro: no toca la base ni React. Lo usan el dashboard y el asistente,
// para que los dos cuenten lo mismo.

import type { Payment } from "./types";
import { claveDeGasto, monthOf, monthsBetween } from "./utils";

/** Cuántos meses hacia atrás se mira. */
export const VENTANA_MESES = 4;

export interface GastoHabitual {
  /** El pago más reciente de este gasto: es el que se repite */
  pago: Payment;
  /** Fecha de la última vez que se pagó */
  ultimaFecha: string;
  /** Monto de esa última vez (referencia, no estimación) */
  ultimoMonto: number;
  /** En cuántos meses distintos de la ventana aparece */
  veces: number;
  /** Meses transcurridos desde la última vez (1 = el mes pasado) */
  mesesDesde: number;
  /** true si aparece en 2+ meses: es claramente algo que se repite */
  habitual: boolean;
}

export interface EntradaGastosHabituales {
  /** Pagos de la ventana, SIN los del mes actual */
  historial: Payment[];
  /** Pagos ya cargados en el mes actual */
  delMesActual: Payment[];
  /** Mes actual (YYYY-MM) */
  mesActual: string;
  /** Servicios dados de baja: lo que se canceló no se sugiere más */
  serviciosCancelados?: Set<string>;
}

/**
 * Gastos de la ventana que este mes todavía no se cargaron, del más habitual y
 * reciente al menos.
 *
 * La identidad la da `claveDeGasto`, que ignora el período de la descripción:
 * "Claude Pro — Julio" y "Claude Pro — Agosto" son el mismo gasto.
 */
export function gastosSinCargarEsteMes(entrada: EntradaGastosHabituales): GastoHabitual[] {
  const { historial, delMesActual, mesActual, serviciosCancelados } = entrada;

  const yaCargado = new Set(delMesActual.map(claveDeGasto));

  // Un pago no confirmado no prueba que el gasto exista: no sirve de referencia.
  const porClave = new Map<string, Payment[]>();
  for (const p of historial) {
    if (p.status !== "paid") continue;
    if (p.service_id && serviciosCancelados?.has(p.service_id)) continue;
    const k = claveDeGasto(p);
    if (yaCargado.has(k)) continue;
    const arr = porClave.get(k);
    if (arr) arr.push(p);
    else porClave.set(k, [p]);
  }

  const salida: GastoHabitual[] = [];
  for (const pagos of porClave.values()) {
    // Del más nuevo al más viejo: el primero es el que se ofrece repetir
    const ordenados = [...pagos].sort((a, b) => b.payment_date.localeCompare(a.payment_date));
    const ultimo = ordenados[0];
    const meses = new Set(ordenados.map((p) => monthOf(p.payment_date)));
    salida.push({
      pago: ultimo,
      ultimaFecha: ultimo.payment_date,
      ultimoMonto: Number(ultimo.amount),
      veces: meses.size,
      mesesDesde: monthsBetween(monthOf(ultimo.payment_date), mesActual),
      habitual: meses.size >= 2,
    });
  }

  // Primero lo que más se repite, y a igual frecuencia lo más reciente: un gasto
  // que apareció los últimos tres meses importa más que uno suelto de hace cuatro.
  return salida.sort(
    (a, b) => b.veces - a.veces || b.ultimaFecha.localeCompare(a.ultimaFecha)
  );
}

/** "el mes pasado" / "hace 3 meses" */
export function desdeCuando(mesesDesde: number): string {
  if (mesesDesde <= 0) return "este mes";
  if (mesesDesde === 1) return "el mes pasado";
  return `hace ${mesesDesde} meses`;
}
