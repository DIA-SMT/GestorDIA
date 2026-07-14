// Generador del PDF de rendición (client-side, jsPDF con import dinámico).
// Lo usan la tabla de rendición y el asistente virtual.

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
  doc.save(opts.filename);
}
