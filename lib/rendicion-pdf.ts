// Generador del PDF de rendición (client-side, jsPDF con import dinámico).
// Lo usan la tabla de rendición y el asistente virtual.
// Si los pagos tienen recibos/facturas cargados, se incrustan en el mismo PDF
// (imágenes en el hueco libre bajo la tabla; PDFs como páginas anexas) con
// pdf-lib, para dejar un único archivo autocontenido.
//
// ESTE MÓDULO ES PURO: arma y descarga el archivo, nunca escribe en la base.
// El marcado como "rendido" lo hace quien lo llama — si no, la herramienta
// `generar_rendicion` del asistente, que promete explícitamente NO marcar nada,
// estaría marcando por la ventana.

export interface RendicionReceiptFile {
  file_name: string;
  mime_type: string | null;
  url: string | null; // URL firmada; null en modo demo o si falló al firmar
}

export interface RendicionPdfRow {
  fecha: string; // ya formateada (dd/mm/aaaa)
  proveedor: string;
  cuit: string;
  descripcion: string;
  comprobante: string;
  nro: string;
  moneda: string;
  monto: number;
  ars: number | null;
  recibo: boolean;
  receipts?: RendicionReceiptFile[]; // archivos adjuntos a incrustar
}

export interface RendicionPdfResult {
  ok: boolean;
  filas: number;
  /** Archivos efectivamente incrustados en el PDF */
  incrustados: number;
  /** Archivos que estaban adjuntos pero no se pudieron traer/incrustar */
  fallidos: number;
  error?: string;
}

type Kind = "pdf" | "png" | "jpg" | "other";

interface FetchedFile {
  file: RendicionReceiptFile;
  kind: Kind;
  bytes: ArrayBuffer | null; // null = no se pudo traer
}

export async function downloadRendicionPdf(opts: {
  title: string;
  rows: RendicionPdfRow[];
  totalARS: number;
  totalUSD: number;
  filename: string;
}): Promise<RendicionPdfResult> {
  try {
    // 1) Primero se traen TODOS los adjuntos, antes de dibujar nada. Así la
    //    columna "Recibo" de la tabla dice lo que realmente entró en el PDF y
    //    no lo que estaba adjunto en la base (que es lo que hacía antes: podía
    //    imprimir "Sí" en 12 filas sin un solo archivo incrustado).
    const traidos: FetchedFile[][] = await Promise.all(
      opts.rows.map((r) =>
        Promise.all(
          (r.receipts ?? []).map(async (f): Promise<FetchedFile> => {
            const kind = fileKind(f);
            if (!f.url) return { file: f, kind, bytes: null };
            try {
              const res = await fetch(f.url);
              if (!res.ok) return { file: f, kind, bytes: null };
              return { file: f, kind, bytes: await res.arrayBuffer() };
            } catch {
              return { file: f, kind, bytes: null };
            }
          })
        )
      )
    );

    const okDe = (i: number) => traidos[i].filter((f) => f.bytes !== null).length;
    const falloDe = (i: number) => traidos[i].filter((f) => f.bytes === null).length;
    const incrustados = opts.rows.reduce((a, _r, i) => a + okDe(i), 0);
    const fallidos = opts.rows.reduce((a, _r, i) => a + falloDe(i), 0);

    // 2) Tabla
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;

    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(15);
    doc.setTextColor(20);
    doc.text(opts.title, 40, 42);
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(
      `Dirección de Inteligencia Artificial · Municipalidad de San Miguel de Tucumán — ${opts.rows.length} pagos confirmados`,
      40,
      58
    );

    autoTable(doc, {
      startY: 74,
      head: [["Fecha", "Proveedor", "CUIT", "Descripción", "Comprobante", "N°", "Moneda", "Monto", "En ARS", "Recibo"]],
      body: opts.rows.map((r, i) => [
        r.fecha,
        r.proveedor || "—",
        r.cuit,
        r.descripcion || "—",
        r.comprobante,
        r.nro,
        r.moneda,
        r.monto.toFixed(2),
        r.ars == null ? "s/cotiz." : Math.round(r.ars).toLocaleString("es-AR"),
        etiquetaRecibo(okDe(i), falloDe(i)),
      ]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [10, 102, 242], fontSize: 8 },
      alternateRowStyles: { fillColor: [244, 248, 255] },
      columnStyles: { 7: { halign: "right" }, 8: { halign: "right" }, 9: { halign: "center" } },
    });

    const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    doc.setFontSize(10);
    doc.setTextColor(20);
    const fmtARS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
    const fmtUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
    doc.text(
      `Total equivalente en ARS: ${fmtARS.format(opts.totalARS)}   ·   Total USD: ${fmtUSD.format(opts.totalUSD)}`,
      40,
      finalY + 22
    );

    // Los pagos sin cotización no pueden convertirse: se aclara en el PDF para
    // que el total no se lea como si fuera todo.
    const sinCotiz = opts.rows.filter((r) => r.ars == null).length;
    if (sinCotiz > 0) {
      doc.setFontSize(8);
      doc.setTextColor(150, 90, 0);
      doc.text(
        `Nota: ${sinCotiz} ${sinCotiz === 1 ? "pago no tiene" : "pagos no tienen"} cotización cargada y no ${
          sinCotiz === 1 ? "está incluido" : "están incluidos"
        } en el total en ARS.`,
        40,
        finalY + 36
      );
    }

    // 3) Adjuntos
    const hayAdjuntos = traidos.some((fs) => fs.some((f) => f.bytes !== null));
    if (!hayAdjuntos) {
      triggerDownload(new Blob([doc.output("arraybuffer")], { type: "application/pdf" }), opts.filename);
      return { ok: true, filas: opts.rows.length, incrustados, fallidos };
    }

    const merged = await appendReceipts(doc.output("arraybuffer"), opts.rows, traidos, finalY + (sinCotiz > 0 ? 44 : 30));
    triggerDownload(new Blob([merged as unknown as BlobPart], { type: "application/pdf" }), opts.filename);
    return { ok: true, filas: opts.rows.length, incrustados, fallidos };
  } catch (e) {
    return {
      ok: false,
      filas: opts.rows.length,
      incrustados: 0,
      fallidos: 0,
      error: e instanceof Error ? e.message : "No se pudo generar el PDF.",
    };
  }
}

function etiquetaRecibo(ok: number, fallo: number): string {
  if (ok === 0 && fallo === 0) return "No";
  if (fallo === 0) return ok === 1 ? "Sí" : `Sí (${ok})`;
  if (ok === 0) return "Error";
  return `${ok} de ${ok + fallo}`;
}

// ---------- Incrustado de recibos con pdf-lib ----------
// Estrategia: aprovechar el hueco libre debajo de la tabla en la última página
// existente. Las imágenes se van apilando ahí y sólo saltan a una página nueva
// cuando no entran. Los PDFs (que son páginas enteras) se anexan aparte.
async function appendReceipts(
  baseBytes: ArrayBuffer,
  rows: RendicionPdfRow[],
  traidos: FetchedFile[][],
  tableEndY: number // dónde termina la tabla+totales, en coord. jsPDF (origen arriba)
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const merged = await PDFDocument.load(baseBytes);
  const font = await merged.embedFont(StandardFonts.Helvetica);
  const fontBold = await merged.embedFont(StandardFonts.HelveticaBold);

  const MARGIN = 36;
  const GAP = 16;
  const CAPTION_H = 16;
  const BAR = 20;
  const MIN_BLOCK = 130; // alto mínimo para meter un recibo en lo que queda de página
  const brand = rgb(0.04, 0.4, 0.95);
  const accent = rgb(0.06, 0.28, 0.62);

  // Arrancamos sobre la última página de la tabla, con el cursor justo debajo
  // de los totales (pdf-lib usa origen abajo, así que invertimos la Y).
  let page = merged.getPage(merged.getPageCount() - 1);
  const size = page.getSize(); // dimensiones de la hoja (misma orientación para las nuevas)
  let cursorY = size.height - tableEndY - 12;

  const captionOf = (r: RendicionPdfRow) => {
    const nro = r.nro ? ` ${r.nro}` : "";
    const monto = `${r.moneda} ${r.monto.toFixed(2)}`;
    return [r.fecha, r.proveedor || "—", `${r.comprobante}${nro}`, monto].filter(Boolean).join("  ·  ");
  };

  const newPage = () => {
    page = merged.addPage([size.width, size.height]);
    cursorY = size.height - MARGIN;
  };

  const drawBar = (pg: import("pdf-lib").PDFPage, text: string) => {
    const { width, height } = pg.getSize();
    pg.drawRectangle({ x: 0, y: height - BAR, width, height: BAR, color: brand });
    pg.drawText(fit(text, font, 9, width - 24), { x: 12, y: height - BAR + 6, size: 9, font, color: rgb(1, 1, 1) });
  };

  const drawCaption = (text: string) => {
    page.drawText(fit("Recibo — " + text, fontBold, 10, size.width - MARGIN * 2), {
      x: MARGIN,
      y: cursorY - 11,
      size: 10,
      font: fontBold,
      color: accent,
    });
    cursorY -= CAPTION_H;
  };

  const placeImage = (caption: string, img: import("pdf-lib").PDFImage) => {
    if (cursorY - MARGIN < MIN_BLOCK) newPage();
    drawCaption(caption);
    const availW = size.width - MARGIN * 2;
    const availH = cursorY - MARGIN;
    const scale = Math.min(availW / img.width, availH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, { x: MARGIN + (availW - w) / 2, y: cursorY - h, width: w, height: h });
    cursorY -= h + GAP;
  };

  // Página informativa para archivos que no se pueden incrustar
  const drawNotice = (title: string, f: RendicionReceiptFile) => {
    const pg = merged.addPage([size.width, size.height]);
    drawBar(pg, title);
    pg.drawText(fit(f.file_name, fontBold, 12, size.width - MARGIN * 2), { x: MARGIN, y: size.height - BAR - 30, size: 12, font: fontBold });
    pg.drawText("Este tipo de archivo no puede incrustarse. Abrilo desde el enlace del CSV o la ficha del pago.", {
      x: MARGIN,
      y: size.height - BAR - 52,
      size: 10,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
    cursorY = -1; // la próxima imagen arranca en página nueva
  };

  for (const [i, r] of rows.entries()) {
    const caption = captionOf(r);
    for (const f of traidos[i]) {
      if (!f.bytes) continue; // no se pudo traer: ya quedó contado como fallido
      try {
        if (f.kind === "pdf") {
          const src = await PDFDocument.load(f.bytes);
          const pages = await merged.copyPages(src, src.getPageIndices());
          pages.forEach((pg, k) => {
            merged.addPage(pg);
            if (k === 0) drawBar(pg, `Recibo — ${caption}`);
          });
          cursorY = -1;
          continue;
        }
        if (f.kind === "png" || f.kind === "jpg") {
          const img = f.kind === "png" ? await merged.embedPng(f.bytes) : await merged.embedJpg(f.bytes);
          placeImage(caption, img);
          continue;
        }
        drawNotice(`Recibo — ${caption}`, f.file);
      } catch {
        drawNotice(`Recibo (no se pudo incrustar) — ${caption}`, f.file);
      }
    }
  }

  return merged.save();
}

function fileKind(f: RendicionReceiptFile): Kind {
  const mime = (f.mime_type ?? "").toLowerCase();
  const name = f.file_name.toLowerCase();
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (mime.includes("png") || name.endsWith(".png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg") || /\.jpe?g$/.test(name)) return "jpg";
  return "other";
}

// Trunca un texto con "…" para que entre en un ancho dado
function fit(text: string, font: import("pdf-lib").PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && font.widthOfTextAtSize(s + "…", size) > maxWidth) s = s.slice(0, -1);
  return s + "…";
}

/**
 * Dispara la descarga de un blob.
 * El <a> TIENE que estar en el DOM y la URL no se puede revocar en la misma
 * vuelta del event loop: hacerlo aborta la descarga en Firefox y Safari.
 */
export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
