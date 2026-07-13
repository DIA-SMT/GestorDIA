"use client";

// Botón genérico que arma un CSV a partir de filas (array de objetos) y lo descarga.
export default function ExportCsv({
  rows,
  filename,
  label = "Exportar CSV",
}: {
  rows: Record<string, string | number | null>[];
  filename: string;
  label?: string;
}) {
  function download() {
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const escape = (v: string | number | null) => {
      const s = v == null ? "" : String(v);
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      headers.join(";"),
      ...rows.map((r) => headers.map((h) => escape(r[h])).join(";")),
    ].join("\r\n");

    // BOM para que Excel abra bien los acentos
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button type="button" className="btn btn-ghost" onClick={download} disabled={rows.length === 0}>
      ⬇ {label}
    </button>
  );
}
