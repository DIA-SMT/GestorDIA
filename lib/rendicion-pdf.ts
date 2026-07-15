// Generador del PDF de rendición (client-side, jsPDF con import dinámico).
// Lo usan la tabla de rendición y el asistente virtual.
// Si los pagos tienen recibos/facturas cargados, se incrustan en el mismo PDF
// (imágenes en el hueco libre bajo la tabla; PDFs como páginas anexas) con
// pdf-lib, para dejar un único archivo autocontenido.

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

export async function downloadRendicionPdf(opts: {
  title: string;
  rows: RendicionPdfRow[];
  totalARS: number;
  totalUSD: number;
  filename: string;
}) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFontSize(15);
  doc.setTextColor(20);
  doc.text(opts.title, 40, 42);
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(
    `Dirección de Inteligencia Artificial · Municipalidad de San Miguel de Tucumán — ${opts.rows.length} pagos`,
    40,
    58
  );

  autoTable(doc, {
    startY: 74,
    head: [["Fecha", "Proveedor", "CUIT", "Descripción", "Comprobante", "N°", "Moneda", "Monto", "En ARS", "Recibo"]],
    body: opts.rows.map((r) => [
      r.fecha,
      r.proveedor || "—",
      r.cuit,
      r.descripcion || "—",
      r.comprobante,
      r.nro,
      r.moneda,
      r.monto.toFixed(2),
      r.ars == null ? "—" : Math.round(r.ars).toLocaleString("es-AR"),
      r.recibo ? "Sí" : "No",
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

  // ¿Hay recibos para incrustar? Si no, guardamos el PDF simple y listo.
  const conRecibos = opts.rows.filter((r) => (r.receipts ?? []).some((f) => f.url));
  if (conRecibos.length === 0) {
    doc.save(opts.filename);
    return;
  }

  const baseBytes = doc.output("arraybuffer");
  const merged = await appendReceipts(baseBytes, conRecibos, finalY + 30);
  const blob = new Blob([merged as unknown as BlobPart], { type: "application/pdf" });
  triggerDownload(blob, opts.filename);
}

// ---------- Incrustado de recibos con pdf-lib ----------
// Estrategia: aprovechar el hueco libre debajo de la tabla en la última página
// existente. Las imágenes se van apilando ahí y sólo saltan a una página nueva
// cuando no entran. Los PDFs (que son páginas enteras) se anexan aparte.
async function appendReceipts(
  baseBytes: ArrayBuffer,
  rows: RendicionPdfRow[],
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

  // Barra superior (para páginas de PDFs incrustados o avisos, sobre fondo propio)
  const drawBar = (pg: import("pdf-lib").PDFPage, text: string) => {
    const { width, height } = pg.getSize();
    pg.drawRectangle({ x: 0, y: height - BAR, width, height: BAR, color: brand });
    pg.drawText(fit(text, font, 9, width - 24), { x: 12, y: height - BAR + 6, size: 9, font, color: rgb(1, 1, 1) });
  };

  // Título de un recibo-imagen apilado en el hueco (texto simple, sin barra)
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

  // Coloca una imagen apilada bajo el cursor; salta de página si no entra
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

  // Página informativa para archivos que no se pueden incrustar (o que fallaron)
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

  for (const r of rows) {
    const caption = captionOf(r);
    for (const f of r.receipts ?? []) {
      if (!f.url) continue;
      const kind = fileKind(f);
      try {
        const bytes = await (await fetch(f.url)).arrayBuffer();

        if (kind === "pdf") {
          // Un PDF es página(s) entera(s): se anexa aparte, no en el hueco.
          const src = await PDFDocument.load(bytes);
          const pages = await merged.copyPages(src, src.getPageIndices());
          pages.forEach((pg, i) => {
            merged.addPage(pg);
            if (i === 0) drawBar(pg, `Recibo — ${caption}`);
          });
          cursorY = -1; // la próxima imagen arranca en página nueva
          continue;
        }

        if (kind === "png" || kind === "jpg") {
          const img = kind === "png" ? await merged.embedPng(bytes) : await merged.embedJpg(bytes);
          placeImage(caption, img);
          continue;
        }

        drawNotice(`Recibo — ${caption}`, f);
      } catch {
        drawNotice(`Recibo (no se pudo cargar) — ${caption}`, f);
      }
    }
  }

  return merged.save();
}

function fileKind(f: RendicionReceiptFile): "pdf" | "png" | "jpg" | "other" {
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

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
