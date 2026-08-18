"use server";

import { revalidatePath } from "next/cache";
import {
  actualizarDatosFiscales,
  crearRendicion,
  getCurrentUser,
  getReceiptUrls,
  getRendicionPdfUrl,
  quitarDeRendicion,
  reabrirRendicion,
  setPaymentsRendido,
  setRendicionPdfPath,
  updateRendicion,
  type CrearRendicionResult,
  type DatosFiscales,
} from "@/lib/data";
import { rutasDeRecibos } from "@/lib/rendicion-doc";
import type { Payment } from "@/lib/types";

// Todo lo que cambia una rendición cambia también el dashboard (cuenta
// pendientes), el listado de pagos y el historial.
function refrescar(): void {
  for (const p of ["/rendicion", "/rendicion/historial", "/", "/pagos"]) revalidatePath(p);
}

export interface CerrarRendicionResult extends CrearRendicionResult {
  /** file_path → URL firmada, para incrustar los recibos en el PDF sin otra vuelta */
  receiptUrls: Record<string, string | null>;
}

/**
 * Cierra la rendición: crea el lote y devuelve, en una sola vuelta, todo lo que
 * el navegador necesita para armar el PDF (los pagos que realmente entraron y
 * las URLs firmadas de sus recibos).
 *
 * El lote se crea ANTES del PDF a propósito: es el registro de que la entrega
 * existe. Si después falla la generación, queda un lote sin PDF archivado —
 * visible y regenerable desde su ficha— en vez de pagos marcados sin lote, que
 * es un estado del que no se vuelve.
 */
export async function cerrarRendicion(
  ids: string[],
  titulo: string | null,
  notas: string | null
): Promise<CerrarRendicionResult> {
  const user = await getCurrentUser();
  const r = await crearRendicion({ ids, titulo, notas }, user?.id ?? null);
  if (r.error || r.payments.length === 0) return { ...r, receiptUrls: {} };

  refrescar();

  let receiptUrls: Record<string, string | null> = {};
  try {
    const paths = rutasDeRecibos(r.payments);
    if (paths.length > 0) receiptUrls = await getReceiptUrls(paths);
  } catch {
    // Sin URLs el PDF sale sin recibos incrustados y lo avisa. No se cae por esto.
  }
  return { ...r, receiptUrls };
}

/** Deja registrado el PDF que el navegador acaba de subir al bucket. */
export async function archivarPdf(rendicionId: string, path: string): Promise<{ error?: string }> {
  const r = await setRendicionPdfPath(rendicionId, path);
  refrescar();
  revalidatePath(`/rendicion/${rendicionId}`);
  return r;
}

/** Reabre un lote entero: sus pagos vuelven a la cola y el lote se borra. */
export async function reabrir(id: string): Promise<{ error?: string; liberados: number }> {
  const r = await reabrirRendicion(id);
  refrescar();
  revalidatePath(`/rendicion/${id}`);
  return r;
}

/** Saca un pago de un lote ya cerrado (el contador lo rebotó, o se coló). */
export async function quitarPago(paymentId: string, rendicionId: string): Promise<{ error?: string }> {
  const r = await quitarDeRendicion(paymentId);
  refrescar();
  revalidatePath(`/rendicion/${rendicionId}`);
  return r;
}

export async function editarCabecera(
  id: string,
  titulo: string | null,
  notas: string | null
): Promise<{ error?: string }> {
  const r = await updateRendicion(id, { titulo, notas });
  revalidatePath(`/rendicion/${id}`);
  revalidatePath("/rendicion/historial");
  return r;
}

/**
 * Guarda los datos de facturación de un pago sin salir de la rendición.
 * Es el paso que más se repite del circuito: el contador manda las facturas y
 * hay que cargar diez números de comprobante seguidos.
 */
export async function guardarDatosFiscales(
  paymentId: string,
  campos: DatosFiscales
): Promise<{ error?: string }> {
  const r = await actualizarDatosFiscales(paymentId, campos);
  refrescar();
  revalidatePath(`/pagos/${paymentId}`);
  return r;
}

/** Firma en lote las URLs de los recibos (para el PDF y el enlace del CSV). */
export async function firmarRecibos(filePaths: string[]): Promise<Record<string, string | null>> {
  return getReceiptUrls(filePaths);
}

/** URL temporal del PDF archivado de un lote. */
export async function urlDelPdfArchivado(path: string): Promise<string | null> {
  return getRendicionPdfUrl(path);
}

/**
 * Marca pagos como rendidos sin crear lote. Queda para el modo degradado
 * (base sin la migración 0005) y para deshacer marcas sueltas heredadas del
 * esquema viejo.
 */
export async function marcarRendidos(
  ids: string[],
  rendido: boolean
): Promise<{ error?: string; updated: number }> {
  const result = await setPaymentsRendido(ids, rendido);
  refrescar();
  return result;
}

/** Los recibos de un conjunto de pagos, firmados, para reimprimir un lote. */
export async function firmarRecibosDePagos(pagos: Payment[]): Promise<Record<string, string | null>> {
  const paths = rutasDeRecibos(pagos);
  if (paths.length === 0) return {};
  return getReceiptUrls(paths);
}
