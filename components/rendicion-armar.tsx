"use client";

// Armado de una rendición: elegir qué se le entrega al contador y cerrar el lote.
//
// La lista NO está partida por mes calendario: muestra todo lo que falta rendir,
// de cualquier período, agrupado por mes con subtotales. Ese es el punto — el
// gasto de enero cuya factura recién llegó en marzo tiene que estar a la vista,
// no escondido detrás de un selector de mes que nadie va a volver a tocar.
//
// Cada fila dice qué le falta para que el contador la acepte y se puede
// completar ahí mismo, sin abrir la ficha del pago.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Category, Payment, ReceiptType } from "@/lib/types";
import { RECEIPT_TYPE_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/types";
import { formatMoney, formatDate, toARS } from "@/lib/utils";
import { PaymentStatusBadge, CategoryTag } from "@/components/badges";
import {
  faltantesDe,
  preparacionDe,
  PREPARACION_COLOR,
  PREPARACION_LABEL,
  type Faltante,
  type Preparacion,
} from "@/lib/rendicion-status";
import { cerrarRendicion, archivarPdf, guardarDatosFiscales, firmarRecibos } from "@/app/(dashboard)/rendicion/actions";
import { downloadRendicionPdf, triggerDownload } from "@/lib/rendicion-pdf";
import { filasDePagos, totalesDePagos, rutasDeRecibos, nombreArchivoDe, subtituloDe, tituloDe } from "@/lib/rendicion-doc";
import { archivarPdfRendicion, HAY_SUPABASE } from "@/lib/rendicion-storage";

type ReceiptLite = { id: string; file_path?: string; file_name?: string; mime_type?: string | null };
type Row = Payment & { receipts?: ReceiptLite[] };
type Aviso = { tipo: "ok" | "warn" | "error"; texto: string };
type FiltroPrep = "" | "listo" | "pendiente";

const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

function mesLegible(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
}

export default function RendicionArmar({
  payments,
  categories,
  migrado,
}: {
  payments: Row[];
  categories: Category[];
  /** false = falta la migración 0005: se marca sin crear lote ni archivar PDF */
  migrado: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [mes, setMes] = useState("");
  const [prep, setPrep] = useState<FiltroPrep>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [titulo, setTitulo] = useState("");
  const [notas, setNotas] = useState("");
  const [verDatos, setVerDatos] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [trabajando, setTrabajando] = useState<null | "generar" | "previa" | "csv">(null);
  const [confirmando, setConfirmando] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Solo se le rinde al contador lo que efectivamente se pagó. Un pago pendiente
  // o fallido no puede entrar: si después se concreta, vuelve a aparecer solo.
  const rendibles = useMemo(() => payments.filter((p) => p.status === "paid"), [payments]);
  const noConfirmados = useMemo(() => payments.filter((p) => p.status !== "paid"), [payments]);

  // El estado de cada pago se calcula una vez y se reusa en fila, filtro y totales
  const estados = useMemo(() => {
    const m = new Map<string, { faltantes: Faltante[]; prep: Preparacion }>();
    for (const p of rendibles) {
      const faltantes = faltantesDe(p);
      m.set(p.id, { faltantes, prep: preparacionDe(faltantes) });
    }
    return m;
  }, [rendibles]);

  const meses = useMemo(() => {
    const set = new Set(rendibles.map((p) => p.payment_date.slice(0, 7)));
    return [...set].sort().reverse();
  }, [rendibles]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const num = query === "" ? NaN : Number(query.replace(/\./g, "").replace(",", "."));
    return rendibles.filter((p) => {
      if (cat && p.category_id !== cat) return false;
      if (mes && p.payment_date.slice(0, 7) !== mes) return false;
      if (prep) {
        const e = estados.get(p.id)!.prep;
        if (prep === "listo" && e !== "listo") return false;
        if (prep === "pendiente" && e === "listo") return false;
      }
      if (!query) return true;
      if (!Number.isNaN(num)) {
        if (Number(p.amount) === num) return true;
        const ars = toARS(Number(p.amount), p.currency, p.exchange_rate);
        if (ars != null && Math.round(ars) === Math.round(num)) return true;
      }
      return [p.description, p.provider, p.receipt_number, p.service?.name].some((s) =>
        s?.toLowerCase().includes(query)
      );
    });
  }, [rendibles, q, cat, mes, prep, estados]);

  // Lo que se va a rendir: la selección, o todo lo filtrado si no se marcó nada
  const target = selected.size > 0 ? filtered.filter((p) => selected.has(p.id)) : filtered;
  const bloqueantes = target.filter((p) => estados.get(p.id)!.prep === "sin_datos");
  const seleccionOculta = selected.size > target.length;

  // Agrupado por mes, del más nuevo al más viejo
  const grupos = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const p of filtered) {
      const k = p.payment_date.slice(0, 7);
      const arr = map.get(k);
      if (arr) arr.push(p);
      else map.set(k, [p]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const todosMarcados = filtered.length > 0 && filtered.every((p) => selected.has(p.id));
  const toggleTodos = () => setSelected(todosMarcados ? new Set() : new Set(filtered.map((p) => p.id)));

  const totales = (rows: Row[]) => totalesDePagos(rows);

  // ---------- Exportar ----------
  async function firmar(rows: Row[]): Promise<{ urls: Record<string, string | null>; fallo: boolean }> {
    const paths = rutasDeRecibos(rows);
    if (paths.length === 0) return { urls: {}, fallo: false };
    try {
      return { urls: await firmarRecibos(paths), fallo: false };
    } catch {
      return { urls: {}, fallo: true };
    }
  }

  async function vistaPrevia() {
    const rows = [...target];
    if (rows.length === 0) return;
    setTrabajando("previa");
    setAviso(null);
    try {
      const { urls } = await firmar(rows);
      const t = totales(rows);
      const r = await downloadRendicionPdf({
        title: "Rendición de cuentas (borrador)",
        subtitulo: `Borrador — ${plural(rows.length, "pago", "pagos")} · no cierra nada`,
        rows: filasDePagos(rows, urls),
        totalARS: t.ars,
        totalUSD: t.usd,
        filename: "rendicion-borrador.pdf",
      });
      setAviso(
        r.ok
          ? { tipo: "ok", texto: `Borrador descargado. No se cerró ninguna rendición.${resumen(r.incrustados, r.fallidos)}` }
          : { tipo: "error", texto: `No se generó el PDF: ${r.error ?? "error desconocido"}.` }
      );
    } finally {
      setTrabajando(null);
    }
  }

  async function descargarCsv() {
    const rows = [...target];
    if (rows.length === 0) return;
    setTrabajando("csv");
    setAviso(null);
    try {
      const { urls } = await firmar(rows);
      const datos = rows.map((p) => {
        const recs = p.receipts ?? [];
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
          Falta: estados.get(p.id)!.faltantes.map((f) => f.label).join(", "),
          Recibos: recs.map((r) => r.file_name).filter(Boolean).join(" | "),
          RecibosURL: recs.map((r) => (r.file_path ? urls[r.file_path] : null)).filter(Boolean).join(" | "),
        };
      });
      const headers = Object.keys(datos[0]) as (keyof (typeof datos)[0])[];
      const esc = (v: string | number | null) => {
        const s = v == null ? "" : String(v);
        return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [headers.join(";"), ...datos.map((r) => headers.map((h) => esc(r[h])).join(";"))].join("\r\n");
      triggerDownload(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }), "rendicion-pendiente.csv");
    } catch {
      setAviso({ tipo: "error", texto: "No se pudo generar el CSV." });
    } finally {
      setTrabajando(null);
    }
  }

  const resumen = (ok: number, fallo: number) => {
    if (fallo === 0) return ok > 0 ? ` ${ok} comprobante(s) incrustado(s).` : "";
    return ` ⚠ ${fallo} comprobante(s) no se pudieron incrustar (figuran como “Error” en la columna Recibo).`;
  };

  // ---------- Cerrar la rendición ----------
  async function generar() {
    // La lista se congela ANTES de cualquier await: armar el PDF con las
    // facturas tarda, y si mientras tanto se toca un filtro se cerraría un
    // conjunto distinto del que se vio en pantalla.
    const rows = [...target];
    const ids = rows.map((p) => p.id);
    if (ids.length === 0) return;

    setConfirmando(false);
    setTrabajando("generar");
    setAviso(null);
    try {
      const r = await cerrarRendicion(ids, titulo.trim() || null, notas.trim() || null);
      if (r.error || r.payments.length === 0) {
        setAviso({ tipo: "error", texto: r.error ?? "No se pudo cerrar la rendición." });
        return;
      }

      const lote = r.rendicion;
      const t = totalesDePagos(r.payments);
      const nombre = lote ? nombreArchivoDe(lote.numero) : "rendicion.pdf";
      const pdf = await downloadRendicionPdf({
        title: lote ? tituloDe(lote) : "Rendición de cuentas",
        subtitulo: lote ? subtituloDe(lote) : undefined,
        rows: filasDePagos(r.payments, r.receiptUrls),
        totalARS: t.ars,
        totalUSD: t.usd,
        filename: nombre,
      });

      const nro = lote ? `N° ${lote.numero}` : "";
      const sobrantes = r.descartados > 0 ? ` ${r.descartados} quedaron afuera (ya rendidos o sin confirmar).` : "";

      if (!pdf.ok) {
        // El lote existe igual: es el registro de la entrega. Se avisa que el
        // papel no salió y desde la ficha del lote se puede reimprimir.
        setAviso({
          tipo: "warn",
          texto: `La rendición ${nro} quedó cerrada con ${plural(r.payments.length, "pago", "pagos")}, pero el PDF no se generó (${
            pdf.error ?? "error desconocido"
          }). Entrá a la rendición y usá “Reimprimir”.`,
        });
      } else {
        // En modo demo no hay Storage: no se intenta archivar ni se avisa de un
        // fallo que no ocurrió.
        let fallóElArchivado = false;
        if (lote && pdf.blob && HAY_SUPABASE) {
          const path = await archivarPdfRendicion(lote.id, pdf.blob, nombre);
          if (path) await archivarPdf(lote.id, path);
          else fallóElArchivado = true;
        }
        setAviso({
          tipo: fallóElArchivado ? "warn" : "ok",
          texto:
            `Rendición ${nro} cerrada con ${plural(r.payments.length, "pago", "pagos")}. PDF descargado.` +
            resumen(pdf.incrustados, pdf.fallidos) +
            sobrantes +
            (fallóElArchivado ? " No se pudo archivar la copia en el servidor: se puede reimprimir desde la ficha." : ""),
        });
      }

      setSelected(new Set());
      setTitulo("");
      setNotas("");
      startTransition(() => router.refresh());
    } catch {
      setAviso({ tipo: "error", texto: "Algo falló al cerrar la rendición. Revisá el historial antes de reintentar." });
    } finally {
      setTrabajando(null);
    }
  }

  const ocupado = trabajando !== null || isPending;
  const etiquetaBoton =
    selected.size > 0 ? plural(target.length, "seleccionado", "seleccionados") : plural(target.length, "pago", "pagos");

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      {!migrado && (
        <div className="card" style={{ padding: "0.9rem 1.15rem", borderColor: "rgba(251,191,36,.4)", background: "rgba(251,191,36,.06)", fontSize: "0.84rem" }}>
          ⚠ Falta correr <code>supabase/migrations/0005_rendiciones.sql</code>. Podés rendir igual, pero los pagos se
          marcan sueltos: sin número de rendición, sin historial y sin el PDF archivado.
        </div>
      )}

      {/* Filtros */}
      <div className="card" style={{ padding: "1rem 1.25rem", display: "grid", gap: "0.85rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "end", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 220px" }}>
            <span className="label">Buscar por nombre, proveedor, N° o monto</span>
            <input className="input" placeholder='Ej: "Claude", 0001-0002345 o 27000' value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div>
            <span className="label">Período</span>
            <select className="select" value={mes} onChange={(e) => setMes(e.target.value)} style={{ width: "auto", minWidth: 165 }}>
              <option value="">Todos los períodos</option>
              {meses.map((m) => (
                <option key={m} value={m} style={{ textTransform: "capitalize" }}>{mesLegible(m)}</option>
              ))}
            </select>
          </div>
          <div>
            <span className="label">Categoría</span>
            <select className="select" value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: "auto", minWidth: 150 }}>
              <option value="">Todas</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <span className="label">Estado de la factura</span>
            <select className="select" value={prep} onChange={(e) => setPrep(e.target.value as FiltroPrep)} style={{ width: "auto", minWidth: 150 }}>
              <option value="">Todos</option>
              <option value="listo">Solo los listos</option>
              <option value="pendiente">Solo los que falta completar</option>
            </select>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setVerDatos((v) => !v)}
          style={{ justifySelf: "start", padding: "0.3rem 0.7rem", fontSize: "0.78rem" }}
        >
          {verDatos ? "▾" : "▸"} Datos de la entrega (opcional)
        </button>
        {verDatos && (
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 240px" }}>
              <span className="label">Título</span>
              <input className="input" placeholder="Ej: Gastos de tarjeta — julio" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            </div>
            <div style={{ flex: "2 1 320px" }}>
              <span className="label">Notas para el contador</span>
              <input className="input" placeholder="Ej: entregado en mano a Contaduría" value={notas} onChange={(e) => setNotas(e.target.value)} />
            </div>
          </div>
        )}

        {seleccionOculta && (
          <p style={{ margin: 0, fontSize: "0.8rem", color: "#fbbf24" }}>
            ⚠ Tenés {selected.size} pagos seleccionados pero el filtro actual muestra {target.length}. Se van a incluir esos {target.length}.
          </p>
        )}
        {noConfirmados.length > 0 && (
          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-muted)" }}>
            {plural(noConfirmados.length, "pago no confirmado queda", "pagos no confirmados quedan")} fuera de la rendición
            (pendiente / fallido / reembolsado). Vuelven a aparecer cuando los pases a “Pagado”.
          </p>
        )}
        <p
          role="status"
          aria-live="polite"
          style={{
            margin: 0,
            minHeight: "1.1em",
            fontSize: "0.85rem",
            color: !aviso ? undefined : aviso.tipo === "ok" ? "#6ee7b7" : aviso.tipo === "warn" ? "#fbbf24" : "#f87171",
          }}
        >
          {aviso ? `${aviso.tipo === "ok" ? "✓ " : "⚠ "}${aviso.texto}` : ""}
        </p>
      </div>

      {/* Lista agrupada por mes */}
      {filtered.length === 0 ? (
        <div className="card" style={{ padding: "2.5rem 1.25rem", textAlign: "center" }}>
          <p style={{ fontSize: "0.95rem", marginBottom: "0.35rem" }}>
            {rendibles.length === 0 ? "No hay nada pendiente de rendir. 🎉" : "Ningún pago coincide con estos filtros."}
          </p>
          <p className="muted" style={{ fontSize: "0.83rem" }}>
            {rendibles.length === 0 ? (
              <>Lo ya entregado está en el <Link href="/rendicion/historial" style={{ color: "var(--text)" }}>historial</Link>.</>
            ) : (
              "Probá limpiando la búsqueda o el período."
            )}
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "1rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
            <input type="checkbox" checked={todosMarcados} onChange={toggleTodos} style={{ accentColor: "#2fa9ff" }} />
            Seleccionar los {filtered.length} pagos visibles
          </label>

          {grupos.map(([m, rows]) => {
            const t = totales(rows);
            return (
              <section key={m} className="card" style={{ overflow: "hidden" }}>
                <div style={{ padding: "0.9rem 1.25rem 0.5rem", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
                  <h2 style={{ fontSize: "0.98rem", fontWeight: 600, margin: 0, textTransform: "capitalize" }}>
                    {mesLegible(m)}{" "}
                    <span className="muted" style={{ fontWeight: 400, fontSize: "0.85rem", textTransform: "none" }}>
                      · {plural(rows.length, "pago", "pagos")}
                    </span>
                  </h2>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                    {formatMoney(t.ars, "ARS")}
                    {t.usd > 0 ? ` · ${formatMoney(t.usd, "USD")}` : ""}
                  </span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--glass-border)", textAlign: "left" }}>
                        <Th style={{ width: 36 }} />
                        <Th>Fecha</Th>
                        <Th>Proveedor / descripción</Th>
                        <Th>Comprobante</Th>
                        <Th style={{ textAlign: "right" }}>Monto</Th>
                        <Th style={{ textAlign: "right" }}>En ARS</Th>
                        <Th>Para rendir</Th>
                        <Th style={{ width: 44 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p) => (
                        <Fila
                          key={p.id}
                          p={p}
                          faltantes={estados.get(p.id)!.faltantes}
                          prep={estados.get(p.id)!.prep}
                          marcado={selected.has(p.id)}
                          onToggle={() => toggle(p.id)}
                          editando={editando === p.id}
                          onEditar={() => setEditando(editando === p.id ? null : p.id)}
                          onGuardado={() => {
                            setEditando(null);
                            startTransition(() => router.refresh());
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Barra de acción: queda pegada abajo para no perderla en una lista larga */}
      {rendibles.length > 0 && (
        <div
          className="card"
          style={{
            position: "sticky",
            bottom: "1rem",
            padding: "0.9rem 1.15rem",
            display: "grid",
            gap: "0.6rem",
            boxShadow: "0 8px 30px rgba(0,0,0,.35)",
          }}
        >
          {confirmando ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.85rem" }}>
                ⚠ {plural(bloqueantes.length, "pago no tiene", "pagos no tienen")} la factura completa
                {bloqueantes.length < target.length ? ` (de ${target.length})` : ""}. ¿Los rindo igual?
              </span>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" className="btn btn-primary" onClick={generar} disabled={ocupado}>
                  Sí, rendir los {target.length}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmando(false)} disabled={ocupado}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ fontSize: "0.85rem" }}>
                <strong>{formatMoney(totales(target).ars, "ARS")}</strong>
                {totales(target).usd > 0 && <span className="muted"> · {formatMoney(totales(target).usd, "USD")}</span>}
                <span className="muted"> en {etiquetaBoton}</span>
                {bloqueantes.length > 0 && (
                  <span style={{ color: "#f87171" }}> · {bloqueantes.length} sin factura</span>
                )}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={target.length === 0 || ocupado}
                  onClick={() => (bloqueantes.length > 0 ? setConfirmando(true) : generar())}
                  title="Cierra el lote, baja el PDF con las facturas incrustadas y lo archiva"
                >
                  {trabajando === "generar" ? "Cerrando rendición…" : `🖨 Rendir y generar comprobante (${target.length})`}
                </button>
                <button type="button" className="btn btn-ghost" disabled={target.length === 0 || ocupado} onClick={vistaPrevia}>
                  {trabajando === "previa" ? "…" : "👁 Vista previa"}
                </button>
                <button type="button" className="btn btn-ghost" disabled={target.length === 0 || ocupado} onClick={descargarCsv}>
                  {trabajando === "csv" ? "…" : "⬇ CSV"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Fila({
  p,
  faltantes,
  prep,
  marcado,
  onToggle,
  editando,
  onEditar,
  onGuardado,
}: {
  p: Row;
  faltantes: Faltante[];
  prep: Preparacion;
  marcado: boolean;
  onToggle: () => void;
  editando: boolean;
  onEditar: () => void;
  onGuardado: () => void;
}) {
  const ars = toARS(Number(p.amount), p.currency, p.exchange_rate);
  const recibos = p.receipts?.length ?? 0;

  return (
    <>
      <tr
        style={{
          borderBottom: editando ? "none" : "1px solid var(--glass-border)",
          background: marcado ? "rgba(47,169,255,0.07)" : undefined,
          cursor: "pointer",
        }}
        onClick={onToggle}
      >
        <Td>
          <input
            type="checkbox"
            checked={marcado}
            onChange={onToggle}
            onClick={(e) => e.stopPropagation()}
            style={{ accentColor: "#2fa9ff" }}
          />
        </Td>
        <Td muted style={{ whiteSpace: "nowrap" }}>{formatDate(p.payment_date)}</Td>
        <Td>
          <div style={{ fontWeight: 500 }}>{p.provider || <span style={{ color: "var(--text-faint)" }}>sin proveedor</span>}</div>
          <Link
            href={`/pagos/${p.id}`}
            onClick={(e) => e.stopPropagation()}
            style={{ fontSize: "0.8rem", color: "var(--text-muted)", textDecoration: "underline", textDecorationColor: "var(--glass-border-strong)", textUnderlineOffset: 3 }}
          >
            {p.description || p.service?.name || "—"}
          </Link>
          {p.category && <div style={{ marginTop: 3 }}><CategoryTag name={p.category.name} color={p.category.color} /></div>}
        </Td>
        <Td>
          <div style={{ fontSize: "0.82rem" }}>{RECEIPT_TYPE_LABELS[p.receipt_type]}</div>
          <div style={{ fontSize: "0.72rem", color: "var(--text-faint)" }}>
            {p.receipt_number || "sin N°"} · {recibos > 0 ? `${recibos} archivo(s)` : "sin archivo"}
          </div>
        </Td>
        <Td style={{ textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{formatMoney(p.amount, p.currency)}</Td>
        <Td muted style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          {ars == null ? <span style={{ color: "#fbbf24" }}>sin cotización</span> : formatMoney(ars, "ARS")}
        </Td>
        <Td>
          {prep === "listo" ? (
            <span style={{ fontSize: "0.78rem", color: PREPARACION_COLOR.listo }}>✓ {PREPARACION_LABEL.listo}</span>
          ) : (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {faltantes.map((f) => (
                <span
                  key={f.key}
                  title={f.ayuda}
                  style={{
                    fontSize: "0.68rem",
                    padding: "1px 6px",
                    borderRadius: 999,
                    border: `1px solid ${f.bloqueante ? "rgba(248,113,113,.5)" : "rgba(251,191,36,.45)"}`,
                    color: f.bloqueante ? "#f87171" : "#fbbf24",
                    whiteSpace: "nowrap",
                  }}
                >
                  falta {f.label}
                </span>
              ))}
            </div>
          )}
        </Td>
        <Td style={{ textAlign: "right" }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={(e) => {
              e.stopPropagation();
              onEditar();
            }}
            title="Cargar los datos de la factura acá mismo"
            style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem" }}
          >
            {editando ? "✕" : "✎"}
          </button>
        </Td>
      </tr>
      {editando && (
        <tr style={{ borderBottom: "1px solid var(--glass-border)", background: "rgba(47,169,255,0.04)" }}>
          <td colSpan={8} style={{ padding: "0.9rem 1.25rem 1.1rem" }}>
            <EditorFiscal p={p} onGuardado={onGuardado} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Edición rápida de los datos de facturación, sin salir de la lista.
 * No incluye subir el archivo: eso necesita la ficha del pago (hay un enlace).
 */
function EditorFiscal({ p, onGuardado }: { p: Row; onGuardado: () => void }) {
  const [provider, setProvider] = useState(p.provider ?? "");
  const [cuit, setCuit] = useState(p.provider_tax_id ?? "");
  const [tipo, setTipo] = useState<ReceiptType>(p.receipt_type);
  const [nro, setNro] = useState(p.receipt_number ?? "");
  const [cotiz, setCotiz] = useState(p.exchange_rate != null ? String(p.exchange_rate) : "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setGuardando(true);
    setError(null);
    const cot = cotiz.trim() === "" ? null : Number(cotiz.replace(",", "."));
    if (cot != null && (Number.isNaN(cot) || cot <= 0)) {
      setError("La cotización tiene que ser un número mayor a cero.");
      setGuardando(false);
      return;
    }
    try {
      const r = await guardarDatosFiscales(p.id, {
        provider: provider.trim() || null,
        provider_tax_id: cuit.trim() || null,
        receipt_type: tipo,
        receipt_number: nro.trim() || null,
        exchange_rate: cot,
      });
      if (r.error) setError(r.error);
      else onGuardado();
    } catch {
      setError("No se pudo guardar. Probá de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "0.7rem" }}>
      <div style={{ display: "flex", gap: "0.7rem", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 180px" }}>
          <span className="label">Proveedor</span>
          <input className="input" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Razón social" />
        </div>
        <div style={{ flex: "1 1 150px" }}>
          <span className="label">CUIT</span>
          <input className="input" value={cuit} onChange={(e) => setCuit(e.target.value)} placeholder="30-71234567-9" />
        </div>
        <div style={{ flex: "1 1 170px" }}>
          <span className="label">Tipo de comprobante</span>
          <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value as ReceiptType)}>
            {(Object.keys(RECEIPT_TYPE_LABELS) as ReceiptType[]).map((k) => (
              <option key={k} value={k}>{RECEIPT_TYPE_LABELS[k]}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: "1 1 150px" }}>
          <span className="label">N° de comprobante</span>
          <input className="input" value={nro} onChange={(e) => setNro(e.target.value)} placeholder="0001-00012345" />
        </div>
        {p.currency !== "ARS" && (
          <div style={{ flex: "1 1 120px" }}>
            <span className="label">Cotización</span>
            <input className="input" value={cotiz} onChange={(e) => setCotiz(e.target.value)} placeholder="1300" inputMode="decimal" />
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" onClick={guardar} disabled={guardando} style={{ padding: "0.35rem 0.8rem", fontSize: "0.8rem" }}>
          {guardando ? "Guardando…" : "Guardar datos"}
        </button>
        <Link href={`/pagos/${p.id}`} className="btn btn-ghost" style={{ padding: "0.35rem 0.8rem", fontSize: "0.8rem" }}>
          Abrir el pago para adjuntar la factura →
        </Link>
        {error && <span style={{ fontSize: "0.8rem", color: "#f87171" }}>⚠ {error}</span>}
      </div>
    </div>
  );
}

function Th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th style={{ padding: "0.6rem 0.85rem", fontSize: "0.71rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.03em", ...style }}>
      {children}
    </th>
  );
}

function Td({ children, muted, style, colSpan }: { children?: React.ReactNode; muted?: boolean; style?: React.CSSProperties; colSpan?: number }) {
  return (
    <td colSpan={colSpan} style={{ padding: "0.65rem 0.85rem", fontSize: "0.86rem", color: muted ? "var(--text-muted)" : "var(--text)", verticalAlign: "top", ...style }}>
      {children}
    </td>
  );
}
