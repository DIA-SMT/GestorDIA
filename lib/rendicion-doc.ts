// Armado del documento de rendición a partir de pagos.
//
// Vive aparte de rendicion-pdf.ts (que dibuja) porque esta traducción
// "pago de la base → fila del comprobante" la necesitan tres lugares: la
// pantalla de armado, la reimpresión de un lote viejo y el asistente. Tenerla
// una sola vez es lo que garantiza que el PDF reimpreso se vea igual al original.

import type { Payment, Rendicion } from "./types";
import { RECEIPT_TYPE_LABELS } from "./types";
import { formatDate, toARS, toLocalDay } from "./utils";
import type { RendicionPdfRow } from "./rendicion-pdf";

type PagoConRecibos = Payment & {
  receipts?: { id: string; file_path?: string; file_name?: string; mime_type?: string | null }[];
};

/** Filas del PDF/CSV. `urls` mapea file_path → URL firmada (o null si falló). */
export function filasDePagos(
  pagos: PagoConRecibos[],
  urls: Record<string, string | null>
): RendicionPdfRow[] {
  return pagos.map((p) => ({
    fecha: formatDate(p.payment_date),
    proveedor: p.provider ?? "",
    cuit: p.provider_tax_id ?? "",
    descripcion: p.description ?? p.service?.name ?? "",
    comprobante: RECEIPT_TYPE_LABELS[p.receipt_type],
    nro: p.receipt_number ?? "",
    moneda: p.currency,
    monto: Number(p.amount),
    ars: toARS(Number(p.amount), p.currency, p.exchange_rate),
    recibo: (p.receipts?.length ?? 0) > 0,
    receipts: (p.receipts ?? []).map((r) => ({
      file_name: r.file_name ?? "recibo",
      mime_type: r.mime_type ?? null,
      url: r.file_path ? urls[r.file_path] ?? null : null,
    })),
  }));
}

export function totalesDePagos(pagos: Pick<Payment, "amount" | "currency" | "exchange_rate">[]) {
  return {
    ars: pagos.reduce((a, p) => a + (toARS(Number(p.amount), p.currency, p.exchange_rate) ?? 0), 0),
    usd: pagos.filter((p) => p.currency === "USD").reduce((a, p) => a + Number(p.amount), 0),
  };
}

/** Rutas únicas de los recibos de un conjunto de pagos, para firmarlas en lote. */
export function rutasDeRecibos(pagos: PagoConRecibos[]): string[] {
  return [
    ...new Set(
      pagos
        .flatMap((p) => p.receipts ?? [])
        .map((r) => r.file_path)
        .filter((p): p is string => !!p)
    ),
  ];
}

/** "03/07/2026 – 28/07/2026" o "03/07/2026" si es un solo día. */
export function rangoLegible(desde: string, hasta: string): string {
  return desde === hasta ? formatDate(desde) : `${formatDate(desde)} – ${formatDate(hasta)}`;
}

/** Identificación del lote: la línea que va bajo el título del PDF. */
export function subtituloDe(r: Pick<Rendicion, "numero" | "presentada_at" | "periodo_desde" | "periodo_hasta">): string {
  return [
    `Rendición N° ${r.numero}`,
    `presentada el ${formatDate(toLocalDay(r.presentada_at))}`,
    `gastos del ${rangoLegible(r.periodo_desde, r.periodo_hasta)}`,
  ].join("   ·   ");
}

export function tituloDe(r: Pick<Rendicion, "numero" | "titulo">): string {
  return r.titulo?.trim() ? r.titulo.trim() : `Rendición de cuentas N° ${r.numero}`;
}

/** rendicion-007.pdf — se ordena solo en la carpeta de descargas. */
export function nombreArchivoDe(numero: number, sufijo = ""): string {
  return `rendicion-${String(numero).padStart(3, "0")}${sufijo}.pdf`;
}
