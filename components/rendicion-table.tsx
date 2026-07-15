"use client";

// Tabla interactiva de rendición: filtrar → seleccionar → exportar (CSV/PDF)
// → marcar como rendidos. Los rendidos pasan a una lista aparte abajo.

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { Category, Payment } from "@/lib/types";
import { RECEIPT_TYPE_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/types";
import { formatMoney, formatDate, toARS } from "@/lib/utils";
import { PaymentStatusBadge, CategoryTag } from "@/components/badges";
import { marcarRendidos, firmarRecibos } from "@/app/(dashboard)/rendicion/actions";
import { downloadRendicionPdf } from "@/lib/rendicion-pdf";

type ReceiptLite = { id: string; file_path?: string; file_name?: string; mime_type?: string | null };
type Row = Payment & { receipts?: ReceiptLite[] };

export default function RendicionTable({
  payments,
  categories,
  mes,
  mesLabel,
}: {
  payments: Row[];
  categories: Category[];
  mes: string;
  mesLabel: string;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<null | "csv" | "pdf">(null);
  const [isPending, startTransition] = useTransition();

  // Filtro: por texto (descripción, proveedor, servicio, nro comprobante)
  // o por monto exacto si lo tipeado es un número. Además, por categoría.
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const num = query === "" ? NaN : Number(query.replace(/\./g, "").replace(",", "."));
    return payments.filter((p) => {
      if (cat && p.category_id !== cat) return false;
      if (!query) return true;
      if (!Number.isNaN(num)) {
        if (Number(p.amount) === num) return true;
        const ars = toARS(Number(p.amount), p.currency, p.exchange_rate);
        if (ars != null && Math.round(ars) === Math.round(num)) return true;
      }
      return [p.description, p.provider, p.receipt_number, p.service?.name]
        .some((s) => s?.toLowerCase().includes(query));
    });
  }, [payments, q, cat]);

  const pendientes = filtered.filter((p) => !p.rendido_at);
  const rendidos = filtered.filter((p) => p.rendido_at);

  // Lo que se exporta / marca: la selección, o todos los pendientes filtrados
  const target = selected.size > 0 ? pendientes.filter((p) => selected.has(p.id)) : pendientes;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = pendientes.length > 0 && pendientes.every((p) => selected.has(p.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(pendientes.map((p) => p.id)));

  const totalARS = (rows: Row[]) =>
    rows.reduce((a, p) => a + (toARS(Number(p.amount), p.currency, p.exchange_rate) ?? 0), 0);
  const totalUSD = (rows: Row[]) =>
    rows.filter((p) => p.currency === "USD").reduce((a, p) => a + Number(p.amount), 0);

  function marcar(ids: string[], rendido: boolean) {
    setError(null);
    startTransition(async () => {
      const r = await marcarRendidos(ids, rendido);
      if (r?.error) setError(r.error);
      else setSelected(new Set());
    });
  }

  // ---------- Exportar ----------
  // Firma en lote las URLs de todos los recibos de las filas dadas (una sola
  // llamada al servidor). Devuelve un mapa file_path -> URL firmada (o null).
  async function signAll(rows: Row[]): Promise<Record<string, string | null>> {
    const paths = rows
      .flatMap((p) => p.receipts ?? [])
      .map((r) => r.file_path)
      .filter((p): p is string => !!p);
    if (paths.length === 0) return {};
    try {
      return await firmarRecibos([...new Set(paths)]);
    } catch {
      return {};
    }
  }

  const exportRows = (rows: Row[], urls: Record<string, string | null>) =>
    rows.map((p) => {
      const recs = p.receipts ?? [];
      const links = recs.map((r) => (r.file_path ? urls[r.file_path] : null)).filter(Boolean);
      return {
        Fecha: p.payment_date,
        Proveedor: p.provider ?? "",
        CUIT: p.provider_tax_id ?? "",
        Descripcion: p.description ?? p.service?.name ?? "",
        Categoria: p.category?.name ?? "",
        TipoComprobante: RECEIPT_TYPE_LABELS[p.receipt_type],
        NroComprobante: p.receipt_number ?? "",
        MedioPago: p.payment_method ?? "",
        Moneda: p.currency,
        Monto: Number(p.amount),
        Cotizacion: p.exchange_rate ?? "",
        MontoARS: toARS(Number(p.amount), p.currency, p.exchange_rate) ?? "",
        Estado: PAYMENT_STATUS_LABELS[p.status],
        TieneRecibo: recs.length > 0 ? "Si" : "No",
        Recibos: recs.map((r) => r.file_name).filter(Boolean).join(" | "),
        RecibosURL: links.join(" | "),
      };
    });

  async function downloadCsv() {
    if (target.length === 0) return;
    setExporting("csv");
    try {
      const urls = await signAll(target);
      const rows = exportRows(target, urls);
      const headers = Object.keys(rows[0]) as (keyof (typeof rows)[0])[];
      const escape = (v: string | number | null) => {
        const s = v == null ? "" : String(v);
        return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [
        headers.join(";"),
        ...rows.map((r) => headers.map((h) => escape(r[h])).join(";")),
      ].join("\r\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
      triggerDownload(blob, `rendicion-${mes}.csv`);
    } finally {
      setExporting(null);
    }
  }

  async function downloadPdf() {
    if (target.length === 0) return;
    setExporting("pdf");
    try {
      const urls = await signAll(target);
      await downloadRendicionPdf({
        title: `Rendición de cuentas — ${mesLabel}`,
        rows: target.map((p) => ({
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
        })),
        totalARS: totalARS(target),
        totalUSD: totalUSD(target),
        filename: `rendicion-${mes}.pdf`,
      });
    } finally {
      setExporting(null);
    }
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const exportLabel = selected.size > 0 ? `${selected.size} seleccionados` : `${pendientes.length} pendientes`;

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      {/* Filtros + acciones */}
      <div className="card" style={{ padding: "1rem 1.25rem", display: "flex", gap: "0.75rem", alignItems: "end", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 220px" }}>
          <span className="label">Buscar por nombre, proveedor o monto</span>
          <input
            className="input"
            placeholder='Ej: "Claude" o 25 o 27000'
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div>
          <span className="label">Categoría</span>
          <select className="select" value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: "auto", minWidth: 160 }}>
            <option value="">Todas</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost" onClick={downloadCsv} disabled={target.length === 0 || exporting !== null}>
            {exporting === "csv" ? "Generando…" : `⬇ CSV (${exportLabel})`}
          </button>
          <button type="button" className="btn btn-ghost" onClick={downloadPdf} disabled={target.length === 0 || exporting !== null}>
            {exporting === "pdf" ? "Armando PDF con recibos…" : `⬇ PDF (${exportLabel})`}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={selected.size === 0 || isPending}
            onClick={() => marcar([...selected], true)}
          >
            {isPending ? "…" : `✓ Marcar como rendidos (${selected.size})`}
          </button>
        </div>
        {error && <p style={{ color: "#f87171", fontSize: "0.85rem", flexBasis: "100%", margin: 0 }}>{error}</p>}
      </div>

      {/* Pendientes de rendir */}
      <section className="card" style={{ overflow: "hidden" }}>
        <div style={{ padding: "1.1rem 1.25rem 0.4rem", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
          <h2 style={{ fontSize: "1.02rem", fontWeight: 600, margin: 0 }}>Pendientes de rendir ({pendientes.length})</h2>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            {selected.size > 0 ? `${selected.size} seleccionados · ` : ""}
            Total: {formatMoney(totalARS(target), "ARS")}{totalUSD(target) > 0 ? ` · ${formatMoney(totalUSD(target), "USD")}` : ""}
          </span>
        </div>
        {pendientes.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", padding: "0.75rem 1.25rem 1.25rem" }}>
            {payments.length === 0 ? "No hay pagos en este período." : "Nada pendiente con estos filtros. 🎉"}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--glass-border)", textAlign: "left" }}>
                  <Th style={{ width: 36 }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Seleccionar todos" style={{ accentColor: "#2fa9ff" }} />
                  </Th>
                  <Th>Fecha</Th>
                  <Th>Proveedor</Th>
                  <Th>Descripción</Th>
                  <Th>Comprobante</Th>
                  <Th style={{ textAlign: "right" }}>Monto</Th>
                  <Th style={{ textAlign: "right" }}>En ARS</Th>
                  <Th>Estado</Th>
                  <Th style={{ textAlign: "center" }}>Recibo</Th>
                </tr>
              </thead>
              <tbody>
                {pendientes.map((p) => (
                  <PaymentRow key={p.id} p={p} selected={selected.has(p.id)} onToggle={() => toggle(p.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Rendidos */}
      <section className="card" style={{ overflow: "hidden", opacity: 0.88 }}>
        <div style={{ padding: "1.1rem 1.25rem 0.4rem", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
          <h2 style={{ fontSize: "1.02rem", fontWeight: 600, margin: 0, color: "#6ee7b7" }}>✓ Rendidos ({rendidos.length})</h2>
          {rendidos.length > 0 && (
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              Total: {formatMoney(totalARS(rendidos), "ARS")}{totalUSD(rendidos) > 0 ? ` · ${formatMoney(totalUSD(rendidos), "USD")}` : ""}
            </span>
          )}
        </div>
        {rendidos.length === 0 ? (
          <p style={{ color: "var(--text-faint)", fontSize: "0.88rem", padding: "0.75rem 1.25rem 1.25rem" }}>
            Todavía no marcaste pagos como rendidos en este período.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--glass-border)", textAlign: "left" }}>
                  <Th>Fecha</Th>
                  <Th>Proveedor</Th>
                  <Th>Descripción</Th>
                  <Th>Comprobante</Th>
                  <Th style={{ textAlign: "right" }}>Monto</Th>
                  <Th style={{ textAlign: "right" }}>En ARS</Th>
                  <Th>Rendido el</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rendidos.map((p) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid var(--glass-border)" }}>
                    <Td muted>{formatDate(p.payment_date)}</Td>
                    <Td>{p.provider ?? "—"}</Td>
                    <Td>
                      <Link href={`/pagos/${p.id}`} style={{ color: "var(--text)" }}>
                        {p.description || p.service?.name || "—"}
                      </Link>
                    </Td>
                    <Td>
                      <div style={{ fontSize: "0.82rem" }}>{RECEIPT_TYPE_LABELS[p.receipt_type]}</div>
                      {p.receipt_number && <div style={{ fontSize: "0.72rem", color: "var(--text-faint)" }}>{p.receipt_number}</div>}
                    </Td>
                    <Td style={{ textAlign: "right", fontWeight: 600 }}>{formatMoney(p.amount, p.currency)}</Td>
                    <Td muted style={{ textAlign: "right" }}>
                      {formatMoney(toARS(Number(p.amount), p.currency, p.exchange_rate), "ARS")}
                    </Td>
                    <Td muted>{formatDate(p.rendido_at?.slice(0, 10))}</Td>
                    <Td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: "0.25rem 0.6rem", fontSize: "0.75rem" }}
                        disabled={isPending}
                        onClick={() => marcar([p.id], false)}
                        title="Volver a pendientes"
                      >
                        ↩ Deshacer
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function PaymentRow({ p, selected, onToggle }: { p: Row; selected: boolean; onToggle: () => void }) {
  const ars = toARS(Number(p.amount), p.currency, p.exchange_rate);
  const hasReceipt = (p.receipts?.length ?? 0) > 0;
  return (
    <tr
      style={{ borderBottom: "1px solid var(--glass-border)", background: selected ? "rgba(47,169,255,0.07)" : undefined, cursor: "pointer" }}
      onClick={onToggle}
    >
      <Td>
        <input type="checkbox" checked={selected} onChange={onToggle} onClick={(e) => e.stopPropagation()} style={{ accentColor: "#2fa9ff" }} />
      </Td>
      <Td muted>{formatDate(p.payment_date)}</Td>
      <Td>
        <div style={{ fontWeight: 500 }}>{p.provider ?? "—"}</div>
        {p.provider_tax_id && <div style={{ fontSize: "0.72rem", color: "var(--text-faint)" }}>{p.provider_tax_id}</div>}
      </Td>
      <Td>
        <Link href={`/pagos/${p.id}`} onClick={(e) => e.stopPropagation()} style={{ color: "var(--text)", textDecoration: "underline", textDecorationColor: "var(--glass-border-strong)", textUnderlineOffset: 3 }}>
          {p.description || p.service?.name || "—"}
        </Link>
        {p.category && <div style={{ marginTop: 3 }}><CategoryTag name={p.category.name} color={p.category.color} /></div>}
      </Td>
      <Td>
        <div style={{ fontSize: "0.82rem" }}>{RECEIPT_TYPE_LABELS[p.receipt_type]}</div>
        {p.receipt_number && <div style={{ fontSize: "0.72rem", color: "var(--text-faint)" }}>{p.receipt_number}</div>}
      </Td>
      <Td style={{ textAlign: "right", fontWeight: 600 }}>{formatMoney(p.amount, p.currency)}</Td>
      <Td muted style={{ textAlign: "right" }}>{formatMoney(ars, "ARS")}</Td>
      <Td><PaymentStatusBadge status={p.status} /></Td>
      <Td style={{ textAlign: "center" }}>
        <span title={hasReceipt ? "Con recibo adjunto" : "Sin recibo"} style={{ color: hasReceipt ? "#6ee7b7" : "var(--text-faint)" }}>
          {hasReceipt ? "✓" : "—"}
        </span>
      </Td>
    </tr>
  );
}

function Th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th style={{ padding: "0.7rem 0.85rem", fontSize: "0.72rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.03em", ...style }}>
      {children}
    </th>
  );
}

function Td({ children, muted, style, colSpan }: { children?: React.ReactNode; muted?: boolean; style?: React.CSSProperties; colSpan?: number }) {
  return (
    <td colSpan={colSpan} style={{ padding: "0.7rem 0.85rem", fontSize: "0.86rem", color: muted ? "var(--text-muted)" : "var(--text)", verticalAlign: "top", ...style }}>
      {children}
    </td>
  );
}
