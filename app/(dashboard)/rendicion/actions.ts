"use server";

import { revalidatePath } from "next/cache";
import { setPaymentsRendido } from "@/lib/data";

// Marca o desmarca pagos como rendidos y refresca la página
export async function marcarRendidos(ids: string[], rendido: boolean): Promise<{ error?: string }> {
  const result = await setPaymentsRendido(ids, rendido);
  revalidatePath("/rendicion");
  return result;
}
