"use client";

// Tabla interactiva de rendición: filtrar → seleccionar → exportar → rendir.
//
// El botón principal es "PDF para imprimir y rendir": genera el PDF y, si salió
// bien, marca esos pagos como rendidos. Hay una vista previa que NO marca, y
// una barra de deshacer con los ids exactos que se marcaron.

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { Category, Payment } from "@/lib/types";
import { RECEIPT_TYPE_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/types";
import { formatMoney, formatDate, toARS, toLocalDay } from "@/lib/utils";
import { PaymentStatusBadge, CategoryTag } from "@/components/badges";
import { marcarRendidos, firmarRecibos } from "@/app/(dashboard)/rendicion/actions";
import { downloadRendicionPdf, triggerDownload, type RendicionPdfResult } from "@/lib/rendicion-pdf";

type ReceiptLite = { id: string; file_path?: string; file_name?: string; mime_type?: string | null };
type Row = Payment & { receipts?: ReceiptLite[] };

type Aviso = { tipo: "ok" | "warn" | "error"; texto: string };

// "1 pago" / "3 pagos"
const plural = (n: number, singular: string, plural_: string) => `${n} ${n === 1 ? singular : plural_}`;

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
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [exporting, setExporting] = useState<null | "csv" | "pdf" | "previa" | "reimprimir">(null);
  const [ultimaTanda, setUltimaTanda] = useState<string[]>([]);
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

  // Al contador solo se le rinde lo que efectivamente se pagó. Un pago
  // pendiente, fallido o reembolsado no puede entrar en el PDF ni cerrarse
  // como rendido: si después se concreta, tiene que volver a aparecer.
  const rendibles = pendientes.filter((p) => p.status === "paid");
  const noConfirmados = pendientes.filter((p) => p.status !== "paid");

  // Lo que se exporta / marca: la selección, o todos los rendibles filtrados
  const target = selected.size > 0 ? rendibles.filter((p) => selected.has(p.id)) : rendibles;
  const sinCotizacion = target.filter((p) => toARS(Number(p.amount), p.currency, p.exchange_rate) == null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = rendibles.length > 0 && rendibles.every((p) => selected.has(p.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(rendibles.map((p) => p.id)));

  const totalARS = (rows: Row[]) =>
    rows.reduce((a, p) => a + (toARS(Number(p.amount), p.currency, p.exchange_rate) ?? 0), 0);
  const totalUSD = (rows: Row[]) =>
    rows.filter((p) => p.currency === "USD").reduce((a, p) => a + Number(p.amount), 0);

  function marcar(
    ids: string[],
    rendido: boolean,
    mensaje?: (n: number) => string,
    alTerminar?: (marcados: number) => void
  ) {
    startTransition(async () => {
      let r: { error?: string; updated: number };
      try {
        r = await marcarRendidos(ids, rendido);
      } catch {
        setAviso({ tipo: "error", texto: "No se pudo guardar el cambio. Probá de nuevo." });
        alTerminar?.(0);
        return;
      }
      if (r?.error) {
        setAviso({ tipo: "error", texto: r.error });
        alTerminar?.(0);
        return;
      }
      setSelected(new Set());
      if (mensaje) setAviso({ tipo: "ok", texto: mensaje(r.updated ?? ids.length) });
      if (!rendido) setUltimaTanda([]);
      alTerminar?.(r.updated ?? 0);
    });
  }

  // ---------- Exportar ----------
  // Firma en lote las URLs de todos los recibos de las filas dadas (una sola
  // llamada al servidor). Devuelve el mapa y si la firma falló por completo.
  async function signAll(rows: Row[]): Promise<{ urls: Record<string, string | null>; fallo: boolean }> {
    const paths = rows
      .flatMap((p) => p.receipts ?? [])
      .map((r) => r.file_path)
      .filter((p): p is string => !!p);
    if (paths.length === 0) return { urls: {}, fallo: false };
    try {
      return { urls: await firmarRecibos([...new Set(paths)]), fallo: false };
    } catch {
      return { urls: {}, fallo: true };
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
    setAviso(null);
    try {
      const { urls } = await signAll(target);
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
      triggerDownload(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }), `rendicion-${mes}.csv`);
    } catch {
      setAviso({ tipo: "error", texto: "No se pudo generar el CSV." });
    } finally {
      setExporting(null);
    }
  }

  // Genera el PDF de un conjunto de filas. No marca nada: eso lo decide quien llama.
  async function generarPdf(rows: Row[], titulo: string, filename: string): Promise<RendicionPdfResult> {
    const { urls, fallo } = await signAll(rows);
    if (fallo) {
      return { ok: false, filas: rows.length, incrustados: 0, fallidos: 0, error: "No se pudieron firmar los recibos." };
    }
    return downloadRendicionPdf({
      title: titulo,
      rows: rows.map((p) => ({
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
      totalARS: totalARS(rows),
      totalUSD: totalUSD(rows),
      filename,
    });
  }

  function resumenPdf(r: RendicionPdfResult): string {
    if (r.fallidos === 0) return r.incrustados > 0 ? ` ${r.incrustados} recibo(s) incrustado(s).` : "";
    return ` ⚠ ${r.fallidos} recibo(s) no se pudieron incrustar (figuran como "Error" en la columna Recibo).`;
  }

  // PDF que además marca como rendidos: es el circuito que pidió el usuario
  // (bajo el PDF para imprimir → esos pagos quedan presentados).
  async function pdfYRendir() {
    // Se congela la lista ANTES de cualquier await: armar el PDF con recibos
    // puede tardar, y si mientras tanto cambia un filtro se marcaría un
    // conjunto distinto del que se imprimió.
    const rows = [...target];
    const ids = rows.map((p) => p.id);
    if (ids.length === 0) return;

    setExporting("pdf");
    setAviso(null);
    try {
      const r = await generarPdf(rows, `Rendición de cuentas — ${mesLabel}`, `rendicion-${mes}.pdf`);
      if (!r.ok) {
        setAviso({ tipo: "error", texto: `No se generó el PDF (${r.error ?? "error desconocido"}). No se marcó nada.` });
        return;
      }
      // La barra de deshacer se muestra SOLO si el marcado salió bien: antes
      // aparecía siempre, así que un fallo al guardar dejaba un cartel verde
      // diciendo que el mes había quedado presentado cuando no lo estaba.
      marcar(
        ids,
        true,
        () => `PDF descargado.${resumenPdf(r)}`,
        (marcados) => setUltimaTanda(marcados > 0 ? ids : [])
      );
    } finally {
      setExporting(null);
    }
  }

  async function vistaPrevia() {
    const rows = [...target];
    if (rows.length === 0) return;
    setExporting("previa");
    setAviso(null);
    try {
      const r = await generarPdf(rows, `Rendición de cuentas (borrador) — ${mesLabel}`, `rendicion-${mes}-borrador.pdf`);
      setAviso(
        r.ok
          ? { tipo: "ok", texto: `Borrador descargado. No se marcó nada como rendido.${resumenPdf(r)}` }
          : { tipo: "error", texto: `No se generó el PDF: ${r.error ?? "error desconocido"}.` }
      );
    } finally {
      setExporting(null);
    }
  }

  // Reimprimir lo ya rendido, sin tocar las marcas
  async function reimprimir() {
    const rows = [...rendidos];
    if (rows.length === 0) return;
    setExporting("reimprimir");
    setAviso(null);
    try {
      const r = await generarPdf(rows, `Rendición de cuentas — ${mesLabel}`, `rendicion-${mes}-reimpresion.pdf`);
      setAviso(
        r.ok
          ? { tipo: "ok", texto: `Reimpresión descargada (${rows.length} pagos ya rendidos).${resumenPdf(r)}` }
          : { tipo: "error", texto: `No se generó el PDF: ${r.error ?? "error desconocido"}.` }
      );
    } finally {
      setExporting(null);
    }
  }

  // Cuenta `target`, no `selected`: la selección sobrevive a cambiar el filtro,
  // así que podés tener 5 marcados y solo 2 visibles. El botón tiene que decir
  // lo que realmente va a imprimir y marcar.
  const exportLabel =
    selected.size > 0
      ? plural(target.length, "seleccionado", "seleccionados")
      : plural(rendibles.length, "pendiente", "pendientes");
  const seleccionOculta = selected.size > target.length;
  const trabajando = exporting !== null || isPending;

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      {/* Filtros + acciones */}
      <div className="card" style={{ padding: "1rem 1.25rem", display: "grid", gap: "0.75rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "end", flexWrap: "wrap" }}>
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
            <button
              type="button"
              className="btn btn-primary"
              onClick={pdfYRendir}
              disabled={target.length === 0 || trabajando}
              title="Genera el PDF y da esos pagos por presentados al contador"
            >
              {exporting === "pdf" ? "Armando PDF…" : `🖨 PDF para imprimir y rendir (${exportLabel})`}
            </button>
            <button type="button" className="btn btn-ghost" onClick={vistaPrevia} disabled={target.length === 0 || trabajando}>
              {exporting === "previa" ? "…" : "👁 Vista previa (no marca)"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={downloadCsv} disabled={target.length === 0 || trabajando}>
              {exporting === "csv" ? "…" : "⬇ CSV"}
            </button>
          </div>
        </div>

        {sinCotizacion.length > 0 && (
          <p style={{ margin: 0, fontSize: "0.8rem", color: "#fbbf24" }}>
            ⚠ {plural(sinCotizacion.length, "pago no tiene", "pagos no tienen")} cotización cargada
            {target.length > sinCotizacion.length ? ` (de ${target.length})` : ""}: no {sinCotizacion.length === 1 ? "suma" : "suman"} en
            el total en ARS del PDF. Cargásela desde el pago si querés que entre.
          </p>
        )}
        {seleccionOculta && (
          <p style={{ margin: 0, fontSize: "0.8rem", color: "#fbbf24" }}>
            ⚠ Tenés {selected.size} pagos seleccionados pero el filtro actual solo muestra {target.length}.
            Se van a incluir esos {target.length}.
          </p>
        )}
        {noConfirmados.length > 0 && (
          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-muted)" }}>
            {noConfirmados.length} {noConfirmados.length === 1 ? "pago no confirmado queda" : "pagos no confirmados quedan"} fuera
            de la rendición (pendiente / fallido / reembolsado). Van a volver a aparecer cuando los pases a “Pagado”.
          </p>
        )}
        {/* Región viva: el resultado se anuncia sin que haya que ir a buscarlo */}
        <p
          role="status"
          aria-live="polite"
          style={{
            margin: 0,
            fontSize: "0.85rem",
            color: !aviso ? undefined : aviso.tipo === "ok" ? "#6ee7b7" : aviso.tipo === "warn" ? "#fbbf24" : "#f87171",
          }}
        >
          {aviso ? `${aviso.tipo === "ok" ? "✓ " : "⚠ "}${aviso.texto}` : ""}
        </p>
      </div>

      {/* Deshacer la última tanda marcada */}
      {ultimaTanda.length > 0 && (
        <div
          className="card"
          style={{
            padding: "0.8rem 1.1rem",
            borderColor: "rgba(52,211,153,.35)",
            background: "rgba(52,211,153,.05)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: "0.85rem" }}>
            ✓ {plural(ultimaTanda.length, "pago quedó presentado", "pagos quedaron presentados")} al contador.
            <span className="muted"> Si la descarga no llegó a completarse, podés revertirlo.</span>
          </span>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }}
              disabled={trabajando}
              onClick={() => marcar(ultimaTanda, false, (n) => `${plural(n, "pago volvió", "pagos volvieron")} a pendientes.`)}
            >
              ↩ Deshacer todo
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }}
              onClick={() => setUltimaTanda([])}
            >
              Listo ✕
            </button>
          </div>
        </div>
      )}

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
            <span style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                Total: {formatMoney(totalARS(rendidos), "ARS")}{totalUSD(rendidos) > 0 ? ` · ${formatMoney(totalUSD(rendidos), "USD")}` : ""}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: "0.3rem 0.7rem", fontSize: "0.78rem" }}
                disabled={trabajando}
                onClick={reimprimir}
                title="Vuelve a generar el PDF de lo ya rendido, sin cambiar nada"
              >
                {exporting === "reimprimir" ? "…" : "↻ Reimprimir PDF"}
              </button>
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
                    <Td muted>{formatDate(toLocalDay(p.rendido_at))}</Td>
                    <Td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: "0.25rem 0.6rem", fontSize: "0.75rem" }}
                        disabled={trabajando}
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
  const rendible = p.status === "paid";
  return (
    <tr
      style={{
        borderBottom: "1px solid var(--glass-border)",
        background: selected ? "rgba(47,169,255,0.07)" : undefined,
        cursor: rendible ? "pointer" : "default",
        opacity: rendible ? 1 : 0.55,
      }}
      onClick={rendible ? onToggle : undefined}
      title={rendible ? undefined : "Solo se rinden los pagos confirmados"}
    >
      <Td>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          disabled={!rendible}
          style={{ accentColor: "#2fa9ff" }}
        />
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
      <Td muted style={{ textAlign: "right" }}>
        {ars == null ? <span style={{ color: "#fbbf24" }}>sin cotización</span> : formatMoney(ars, "ARS")}
      </Td>
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
