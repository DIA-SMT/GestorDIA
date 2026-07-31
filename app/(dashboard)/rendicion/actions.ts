"use server";

import { revalidatePath } from "next/cache";
import { setPaymentsRendido, getReceiptUrls } from "@/lib/data";

// Marca o desmarca pagos como rendidos y refresca las vistas que dependen de eso
// (la rendición, y el dashboard, que cuenta pendientes y cargos por confirmar).
export async function marcarRendidos(
  ids: string[],
  rendido: boolean
): Promise<{ error?: string; updated: number }> {
  const result = await setPaymentsRendido(ids, rendido);
  revalidatePath("/rendicion");
  revalidatePath("/");
  revalidatePath("/pagos");
  return result;
}

// Firma en lote las URLs de los recibos para exportar la rendición
// (enlace en el CSV e incrustado en el PDF). Enlaces válidos 7 días.
export async function firmarRecibos(filePaths: string[]): Promise<Record<string, string | null>> {
  return getReceiptUrls(filePaths);
}
