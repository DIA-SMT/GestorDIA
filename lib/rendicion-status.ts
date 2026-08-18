// ¿Este pago está listo para que el contador lo acepte?
//
// El circuito real es: se anota el gasto cuando se paga (que es cuando se sabe
// el monto) y los datos fiscales llegan después, cuando el contador pide las
// facturas. Entre esos dos momentos el pago está incompleto, y el problema no
// es que falte algo sino no saber QUÉ falta ni en cuáles.
//
// Módulo puro: no toca la base ni React. Lo usan la pantalla de armado, el
// detalle del pago y el PDF.

import type { Payment, ReceiptType } from "./types";
import { toARS } from "./utils";

export type FaltanteKey = "proveedor" | "cuit" | "comprobante" | "numero" | "archivo" | "cotizacion";

export interface Faltante {
  key: FaltanteKey;
  /** Etiqueta corta para el chip */
  label: string;
  /** Qué hacer, para el tooltip */
  ayuda: string;
  /** true = el contador lo va a rebotar; false = molesta pero se puede rendir */
  bloqueante: boolean;
}

const DEF: Record<FaltanteKey, Omit<Faltante, "key">> = {
  comprobante: {
    label: "tipo de comprobante",
    ayuda: "Está como “Sin comprobante”: elegí factura A/B/C, ticket, recibo o comprobante del exterior.",
    bloqueante: true,
  },
  archivo: {
    label: "archivo adjunto",
    ayuda: "No hay ninguna factura ni recibo subido. Es lo que el contador necesita ver.",
    bloqueante: true,
  },
  numero: {
    label: "N° de comprobante",
    ayuda: "Falta el número de la factura (ej: 0001-00012345).",
    bloqueante: true,
  },
  proveedor: {
    label: "proveedor",
    ayuda: "Falta la razón social de quien emitió el comprobante.",
    bloqueante: false,
  },
  cuit: {
    label: "CUIT",
    ayuda: "Falta la identificación fiscal del proveedor.",
    bloqueante: false,
  },
  cotizacion: {
    label: "cotización",
    ayuda: "Es un pago en moneda extranjera sin cotización: no suma en el total en pesos.",
    bloqueante: false,
  },
};

const vacio = (s: string | null | undefined) => !s || s.trim() === "";

// Un comprobante del exterior no tiene CUIT argentino: exigirlo dejaría esos
// pagos marcados como incompletos para siempre.
const requiereCuit = (t: ReceiptType) => t !== "comprobante_exterior" && t !== "sin_comprobante";

type PagoParaChequear = Pick<
  Payment,
  "provider" | "provider_tax_id" | "receipt_type" | "receipt_number" | "amount" | "currency" | "exchange_rate"
> & { receipts?: { id: string }[] };

/** Qué le falta a un pago para poder rendirse, en orden de importancia. */
export function faltantesDe(p: PagoParaChequear): Faltante[] {
  const keys: FaltanteKey[] = [];

  if (p.receipt_type === "sin_comprobante") keys.push("comprobante");
  if ((p.receipts?.length ?? 0) === 0) keys.push("archivo");
  if (p.receipt_type !== "sin_comprobante" && vacio(p.receipt_number)) keys.push("numero");
  if (vacio(p.provider)) keys.push("proveedor");
  if (requiereCuit(p.receipt_type) && vacio(p.provider_tax_id)) keys.push("cuit");
  if (toARS(Number(p.amount), p.currency, p.exchange_rate) == null) keys.push("cotizacion");

  return keys.map((key) => ({ key, ...DEF[key] }));
}

export type Preparacion = "listo" | "incompleto" | "sin_datos";

/**
 * Semáforo de un pago:
 *   listo      → no le falta nada
 *   incompleto → le faltan cosas menores (proveedor, CUIT, cotización)
 *   sin_datos  → le falta lo que el contador va a rebotar (comprobante/archivo/N°)
 */
export function preparacionDe(faltantes: Faltante[]): Preparacion {
  if (faltantes.length === 0) return "listo";
  return faltantes.some((f) => f.bloqueante) ? "sin_datos" : "incompleto";
}

export const PREPARACION_COLOR: Record<Preparacion, string> = {
  listo: "#6ee7b7",
  incompleto: "#fbbf24",
  sin_datos: "#f87171",
};

export const PREPARACION_LABEL: Record<Preparacion, string> = {
  listo: "Listo para rendir",
  incompleto: "Faltan datos menores",
  sin_datos: "Falta la factura",
};

/** Resumen de un conjunto, para los contadores de la pantalla. */
export function resumirPreparacion(pagos: PagoParaChequear[]) {
  let listos = 0;
  let incompletos = 0;
  let sinDatos = 0;
  for (const p of pagos) {
    const estado = preparacionDe(faltantesDe(p));
    if (estado === "listo") listos++;
    else if (estado === "incompleto") incompletos++;
    else sinDatos++;
  }
  return { listos, incompletos, sinDatos, total: pagos.length };
}
