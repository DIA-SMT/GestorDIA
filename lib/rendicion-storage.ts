"use client";

// Archivado del PDF de rendición en Supabase Storage.
//
// Sube DIRECTO desde el navegador, no vía server action, por una razón concreta:
// las server actions de Next tienen un límite de body de 1 MB y un PDF de
// rendición con las facturas incrustadas pesa varios megas. Mandarlo por ahí
// fallaría justo en las rendiciones grandes, que son las que más importa
// archivar. El bucket 'rendiciones' es privado y su policy de insert exige
// sesión autenticada, así que el navegador no puede subir nada de más.

import { createClient } from "./supabase/client";

export const HAY_SUPABASE =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Sube el PDF y devuelve la ruta dentro del bucket, o null si no se pudo.
 *
 * Nunca tira: que el archivado falle no puede romper la rendición. El lote ya
 * existe y el usuario ya tiene el PDF descargado; lo único que se pierde es la
 * copia, y la pantalla del lote ofrece volver a generarla.
 */
export async function archivarPdfRendicion(
  rendicionId: string,
  blob: Blob,
  filename: string
): Promise<string | null> {
  if (!HAY_SUPABASE) return null;
  try {
    const supabase = createClient();
    const safe = filename.replace(/[^\w.\-]/g, "_");
    const path = `${rendicionId}/${safe}`;
    const { error } = await supabase.storage
      .from("rendiciones")
      .upload(path, blob, { contentType: "application/pdf", upsert: true });
    if (error) {
      console.warn("[gestorDIA] No se pudo archivar el PDF de la rendición:", error.message);
      return null;
    }
    return path;
  } catch (e) {
    console.warn("[gestorDIA] No se pudo archivar el PDF de la rendición:", e);
    return null;
  }
}
