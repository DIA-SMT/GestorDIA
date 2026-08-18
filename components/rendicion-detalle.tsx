"use client";

// Ficha de una rendición ya presentada: qué se entregó, por cuánto, y el
// comprobante exacto que se imprimió.
//
// "Descargar el archivado" y "Reimprimir" no son lo mismo y la diferencia
// importa: el archivado es el PDF que se le dio al contador, byte por byte. El
// reimpreso se vuelve a armar con los datos de hoy, así que si desde entonces
// se corrigió una cotización o se subió una factura que faltaba, va a salir
// distinto. Por eso el botón lo dice.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Payment, Rendicion } from "@/lib/types";
import { RECEIPT_TYPE_LABELS } from "@/lib/types";
import { formatMoney, formatDate, toARS, toLocalDay } from "@/lib/utils";
import { CategoryTag } from "@/components/badges";
import {
  editarCabecera,
  firmarRecibos,
  quitarPago,
  reabrir,
  urlDelPdfArchivado,
  archivarPdf,
} from "@/app/(dashboard)/rendicion/actions";
import { downloadRendicionPdf } from "@/lib/rendicion-pdf";
import { filasDePagos, totalesDePagos, rutasDeRecibos, nombreArchivoDe, subtituloDe, tituloDe } from "@/lib/rendicion-doc";
import { archivarPdfRendicion, HAY_SUPABASE } from "@/lib/rendicion-storage";

type Row = Payment & { receipts?: { id: string; file_path?: string; file_name?: string; mime_type?: string | null }[] };
type Aviso = { tipo: "ok" | "warn" | "error"; texto: string };

const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

export default function RendicionDetalle({
  rendicion,
  payments,
  demo,
}: {
  rendicion: Rendicion;
  payments: Row[];
  /** En modo demo no hay archivo real en Storage: se avisa en vez de fallar */
  demo: boolean;
}) {
  const router = useRouter();
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [trabajando, setTrabajando] = useState<null | "archivado" | "reimprimir" | "reabrir" | "quitar">(null);
  const [confirmandoReabrir, setConfirmandoReabrir] = useState(false);
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState(rendicion.titulo ?? "");
  const [notas, setNotas] = useState(rendicion.notas ?? "");
  const [isPending, startTransition] = useTransition();

  const ocupado = trabajando !== null || isPending;
  const vivos = totalesDePagos(payments);
  // Los totales del lote están congelados. Si el detalle de hoy no coincide, es
  // porque se editó un pago después de entregarlo: mejor decirlo que disimularlo.
  const desfasado =
    Math.abs(vivos.ars - Number(rendicion.total_ars)) > 1 || Math.abs(vivos.usd - Number(rendicion.total_usd)) > 0.01;

  async function bajarArchivado() {
    if (!rendicion.pdf_path) return;
    setTrabajando("archivado");
    setAviso(null);
    try {
      const url = await urlDelPdfArchivado(rendicion.pdf_path);
      if (!url) {
        setAviso({ tipo: "error", texto: demo ? "En modo demo no hay archivo real guardado." : "No se pudo abrir el PDF archivado." });
        return;
      }
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener";
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      setAviso({ tipo: "error", texto: "No se pudo abrir el PDF archivado." });
    } finally {
      setTrabajando(null);
    }
  }

  async function reimprimir() {
    if (payments.length === 0) return;
    setTrabajando("reimprimir");
    setAviso(null);
    try {
      let urls: Record<string, string | null> = {};
      const paths = rutasDeRecibos(payments);
      if (paths.length > 0) {
        try {
          urls = await firmarRecibos(paths);
        } catch {
          // Sin URLs el PDF sale sin facturas incrustadas; el resumen lo dice
        }
      }
      const t = totalesDePagos(payments);
      const nombre = nombreArchivoDe(rendicion.numero, rendicion.pdf_path ? "-reimpresion" : "");
      const r = await downloadRendicionPdf({
        title: tituloDe(rendicion),
        subtitulo: subtituloDe(rendicion),
        rows: filasDePagos(payments, urls),
        totalARS: t.ars,
        totalUSD: t.usd,
        filename: nombre,
      });
      if (!r.ok) {
        setAviso({ tipo: "error", texto: `No se generó el PDF: ${r.error ?? "error desconocido"}.` });
        return;
      }
      // Si el lote nunca llegó a archivar su copia (falló la subida, o se cerró
      // antes de la 0005), esta reimpresión la completa.
      if (!rendicion.pdf_path && r.blob && HAY_SUPABASE) {
        const path = await archivarPdfRendicion(rendicion.id, r.blob, nombreArchivoDe(rendicion.numero));
        if (path) {
          await archivarPdf(rendicion.id, path);
          setAviso({ tipo: "ok", texto: "PDF regenerado y archivado. Ya queda guardado en la rendición." });
          startTransition(() => router.refresh());
          return;
        }
      }
      setAviso({ tipo: "ok", texto: "PDF regenerado con los datos actuales." });
    } finally {
      setTrabajando(null);
    }
  }

  async function hacerReabrir() {
    setTrabajando("reabrir");
    setAviso(null);
    try {
      const r = await reabrir(rendicion.id);
      if (r.error) {
        setAviso({ tipo: "error", texto: r.error });
        return;
      }
      router.push("/rendicion");
    } finally {
      setTrabajando(null);
    }
  }

  async function sacar(p: Row) {
    setTrabajando("quitar");
    setAviso(null);
    try {
      const r = await quitarPago(p.id, rendicion.id);
      if (r.error) {
        setAviso({ tipo: "error", texto: r.error });
        return;
      }
      if (payments.length === 1) {
        // Se sacó el último: el lote deja de existir
        router.push("/rendicion/historial");
        return;
      }
      setAviso({ tipo: "ok", texto: "El pago volvió a la cola de pendientes y los totales se recalcularon." });
      startTransition(() => router.refresh());
    } finally {
      setTrabajando(null);
    }
  }

  async function guardarCabecera() {
    setAviso(null);
    const r = await editarCabecera(rendicion.id, titulo.trim() || null, notas.trim() || null);
    if (r.error) {
      setAviso({ tipo: "error", texto: r.error });
      return;
    }
    setEditando(false);
    startTransition(() => router.refresh());
  }

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      {/* Acciones */}
      <div className="card" style={{ padding: "1rem 1.25rem", display: "grid", gap: "0.75rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={bajarArchivado}
            disabled={!rendicion.pdf_path || ocupado}
            title={
              rendicion.pdf_path
                ? "El PDF exacto que se le entregó al contador"
                : "Esta rendición no tiene copia archivada: usá Reimprimir"
            }
          >
            {trabajando === "archivado" ? "…" : "📄 Descargar el comprobante entregado"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={reimprimir} disabled={ocupado || payments.length === 0}>
            {trabajando === "reimprimir" ? "…" : "↻ Reimprimir con los datos de hoy"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setEditando((v) => !v)} disabled={ocupado}>
            ✎ Título y notas
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setConfirmandoReabrir(true)}
            disabled={ocupado}
            style={{ marginLeft: "auto", color: "#f87171" }}
            title="Los pagos vuelven a pendientes y esta rendición se borra"
          >
            ↩ Reabrir
          </button>
        </div>

        {!rendicion.pdf_path && (
          <p style={{ margin: 0, fontSize: "0.8rem", color: "#fbbf24" }}>
            ⚠ Esta rendición no tiene el PDF archivado{" "}
            {demo ? "(en modo demo no se guardan archivos)" : "(se cerró antes de la migración 0005, o falló la subida)"}.
            “Reimprimir” lo genera y lo deja guardado.
          </p>
        )}
        {desfasado && (
          <p style={{ margin: 0, fontSize: "0.8rem", color: "#fbbf24" }}>
            ⚠ Los pagos cambiaron después de entregarse: hoy suman {formatMoney(vivos.ars, "ARS")} y la rendición se
            cerró en {formatMoney(Number(rendicion.total_ars), "ARS")}. El comprobante archivado sigue siendo el válido.
          </p>
        )}

        {confirmandoReabrir && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.85rem" }}>
              ⚠ Reabrir borra la rendición N° {rendicion.numero}: sus {plural(payments.length, "pago vuelve", "pagos vuelven")} a
              pendientes y {rendicion.pdf_path ? "se borra el PDF archivado" : "no queda registro de la entrega"}.
            </span>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="button" className="btn btn-primary" onClick={hacerReabrir} disabled={ocupado}>
                {trabajando === "reabrir" ? "…" : "Sí, reabrir"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmandoReabrir(false)} disabled={ocupado}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {editando && (
          <div style={{ display: "grid", gap: "0.6rem" }}>
            <div style={{ display: "flex", gap: "0.7rem", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 240px" }}>
                <span className="label">Título</span>
                <input className="input" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={`Rendición N° ${rendicion.numero}`} />
              </div>
              <div style={{ flex: "2 1 320px" }}>
                <span className="label">Notas</span>
                <input className="input" value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej: entregada en mano a Contaduría" />
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="button" className="btn btn-primary" onClick={guardarCabecera} disabled={ocupado} style={{ padding: "0.35rem 0.8rem", fontSize: "0.8rem" }}>
                Guardar
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditando(false)} style={{ padding: "0.35rem 0.8rem", fontSize: "0.8rem" }}>
                Cancelar
              </button>
            </div>
          </div>
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

      {/* Detalle */}
      <section className="card" style={{ overflow: "hidden" }}>
        <div style={{ padding: "1.1rem 1.25rem 0.4rem" }}>
          <h2 style={{ fontSize: "1.02rem", fontWeight: 600, margin: 0 }}>
            Pagos incluidos ({payments.length})
          </h2>
        </div>
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
                <Th style={{ textAlign: "center" }}>Factura</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const ars = toARS(Number(p.amount), p.currency, p.exchange_rate);
                const tiene = (p.receipts?.length ?? 0) > 0;
                return (
                  <tr key={p.id} style={{ borderBottom: "1px solid var(--glass-border)" }}>
                    <Td muted style={{ whiteSpace: "nowrap" }}>{formatDate(p.payment_date)}</Td>
                    <Td>
                      <div>{p.provider ?? "—"}</div>
                      {p.provider_tax_id && (
                        <div style={{ fontSize: "0.72rem", color: "var(--text-faint)" }}>{p.provider_tax_id}</div>
                      )}
                    </Td>
                    <Td>
                      <Link href={`/pagos/${p.id}`} style={{ color: "var(--text)" }}>
                        {p.description || p.service?.name || "—"}
                      </Link>
                      {p.category && (
                        <div style={{ marginTop: 3 }}><CategoryTag name={p.category.name} color={p.category.color} /></div>
                      )}
                    </Td>
                    <Td>
                      <div style={{ fontSize: "0.82rem" }}>{RECEIPT_TYPE_LABELS[p.receipt_type]}</div>
                      {p.receipt_number && (
                        <div style={{ fontSize: "0.72rem", color: "var(--text-faint)" }}>{p.receipt_number}</div>
                      )}
                    </Td>
                    <Td style={{ textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>
                      {formatMoney(p.amount, p.currency)}
                    </Td>
                    <Td muted style={{ textAlign: "right", whiteSpace: "nowrap" }}>{formatMoney(ars, "ARS")}</Td>
                    <Td style={{ textAlign: "center", color: tiene ? "#6ee7b7" : "var(--text-faint)" }}>
                      {tiene ? "✓" : "—"}
                    </Td>
                    <Td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={ocupado}
                        onClick={() => sacar(p)}
                        title="Sacar este pago de la rendición y devolverlo a pendientes"
                        style={{ padding: "0.2rem 0.55rem", fontSize: "0.74rem" }}
                      >
                        ↩ Sacar
                      </button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="muted" style={{ fontSize: "0.8rem" }}>
        Presentada el {formatDate(toLocalDay(rendicion.presentada_at))}. Si el contador rebota un pago, sacalo con “↩
        Sacar”: vuelve a la cola de pendientes y los totales de esta rendición se recalculan.
      </p>
    </div>
  );
}

function Th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th style={{ padding: "0.7rem 0.85rem", fontSize: "0.72rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.03em", ...style }}>
      {children}
    </th>
  );
}

function Td({ children, muted, style }: { children?: React.ReactNode; muted?: boolean; style?: React.CSSProperties }) {
  return (
    <td style={{ padding: "0.7rem 0.85rem", fontSize: "0.86rem", color: muted ? "var(--text-muted)" : "var(--text)", verticalAlign: "top", ...style }}>
      {children}
    </td>
  );
}
