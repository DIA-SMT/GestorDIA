"use client";

// Cargos recurrentes esperando el OK del usuario.
//
// Un servicio mensual propone su gasto cada mes; el usuario confirma (se crea
// el pago del período), lo omite, o da de baja el servicio si ya no lo usan.
// Nada se crea solo: sin OK no hay gasto.

import { useState, useTransition } from "react";
import Link from "next/link";
import type { PendingCharge, ServicePending } from "@/lib/recurring";
import { formatMoney, formatDate } from "@/lib/utils";
import { CategoryTag } from "@/components/badges";
import {
  confirmarCargo,
  omitirCargo,
  darDeBajaServicio,
  ponerAlDia,
} from "@/app/(dashboard)/recurrentes/actions";

type Nota = { tipo: "ok" | "error"; texto: string };

export default function PendingCharges({
  groups,
  migrado = true,
  titulo = "Cargos por confirmar",
}: {
  groups: ServicePending[];
  migrado?: boolean;
  titulo?: string;
}) {
  const [nota, setNota] = useState<Nota | null>(null);
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const cargos = groups
    .flatMap((g) => g.charges)
    .sort((a, b) => a.cycleDate.localeCompare(b.cycleDate) || a.serviceName.localeCompare(b.serviceName));

  const atrasados = groups.filter((g) => g.truncated);

  // Puede no haber ningún cargo visible y aun así haber servicios con el ancla
  // atrasada (todos sus ciclos quedaron por debajo del piso de 12 meses):
  // esos necesitan el "Poner al día" igual.
  if (cargos.length === 0 && atrasados.length === 0) return null;

  function correr(id: string, fn: () => Promise<{ ok: boolean; message: string }>) {
    setEnCurso(id);
    setNota(null);
    startTransition(async () => {
      try {
        const r = await fn();
        setNota({ tipo: r.ok ? "ok" : "error", texto: r.message });
      } catch {
        setNota({ tipo: "error", texto: "No se pudo completar la acción. Probá de nuevo." });
      } finally {
        setEnCurso(null);
      }
    });
  }

  // Confirma todos de a uno y en orden: cada confirmación mueve el ancla del
  // servicio, así que no se pueden mandar en paralelo.
  function confirmarTodos() {
    setEnCurso("__todos__");
    setNota(null);
    startTransition(async () => {
      let ok = 0;
      const fallos: string[] = [];
      for (const c of cargos) {
        if (c.duplicate) continue; // los dudosos se revisan a mano
        try {
          const r = await confirmarCargo(c.serviceId, c.cycleDate);
          if (r.ok) ok++;
          else fallos.push(`${c.serviceName}: ${r.message}`);
        } catch {
          fallos.push(`${c.serviceName}: error inesperado`);
        }
      }
      setEnCurso(null);
      setNota({
        tipo: fallos.length === 0 ? "ok" : "error",
        texto:
          `${ok} ${ok === 1 ? "cargo confirmado" : "cargos confirmados"}.` +
          (fallos.length ? ` No se pudieron: ${fallos.join(" · ")}` : ""),
      });
    });
  }

  const confirmables = cargos.filter((c) => !c.duplicate).length;
  const trabajando = enCurso !== null;

  return (
    <section
      className="card"
      style={{ padding: "1.5rem 1.6rem", borderColor: "rgba(47,169,255,.38)", display: "grid", gap: "1rem" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 600, margin: 0, color: "var(--primary)" }}>
            ⚡ {titulo}{cargos.length > 0 ? ` (${cargos.length})` : ""}
          </h2>
          <p className="muted" style={{ fontSize: "0.82rem", margin: "0.3rem 0 0", maxWidth: "62ch" }}>
            Estos servicios volvieron a renovar. Confirmá los que efectivamente se cobraron para que
            entren en la rendición del mes; si dieron de baja alguno, omitilo o marcalo como no usado.
          </p>
        </div>
        {confirmables > 1 && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={trabajando}
            onClick={confirmarTodos}
            style={{ whiteSpace: "nowrap" }}
          >
            {enCurso === "__todos__" ? "Confirmando…" : `✓ Confirmar los ${confirmables}`}
          </button>
        )}
      </div>

      {!migrado && (
        <p
          style={{
            fontSize: "0.78rem",
            color: "#fbbf24",
            background: "rgba(251,191,36,.07)",
            border: "1px solid rgba(251,191,36,.25)",
            borderRadius: 10,
            padding: "0.6rem 0.8rem",
            margin: 0,
          }}
        >
          ⚠ Falta correr <code>supabase/migrations/0004_cargos_recurrentes.sql</code>. Mientras tanto se
          muestra un solo ciclo por servicio y no hay protección contra confirmar dos veces.
        </p>
      )}

      <div style={{ display: "grid", gap: "0.55rem" }}>
        {cargos.map((c) => (
          <ChargeRow
            key={c.key}
            c={c}
            trabajando={trabajando}
            enCurso={enCurso === c.key}
            onConfirmar={() => correr(c.key, () => confirmarCargo(c.serviceId, c.cycleDate))}
            onOmitir={() => correr(c.key, () => omitirCargo(c.serviceId, c.cycleDate))}
            onBaja={() => correr(c.key, () => darDeBajaServicio(c.serviceId))}
          />
        ))}
      </div>

      {atrasados.length > 0 && (
        <div style={{ display: "grid", gap: "0.4rem", borderTop: "1px solid var(--glass-border)", paddingTop: "0.8rem" }}>
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
            Hay servicios con más ciclos atrasados de los que se muestran. Si esos gastos ya los
            cargaste a mano, poné el servicio al día sin generar pagos:
          </span>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {atrasados.map((g) => (
              <button
                key={g.serviceId}
                type="button"
                className="btn btn-ghost"
                style={{ padding: "0.3rem 0.7rem", fontSize: "0.78rem" }}
                disabled={trabajando}
                onClick={() => correr(`aldia-${g.serviceId}`, () => ponerAlDia(g.serviceId))}
              >
                ⏩ Poner al día: {g.serviceName}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Región viva: confirmar/omitir avisa el resultado sin recargar la vista */}
      <p
        role="status"
        aria-live="polite"
        style={{
          margin: 0,
          fontSize: "0.83rem",
          color: !nota ? undefined : nota.tipo === "ok" ? "#6ee7b7" : "#f87171",
        }}
      >
        {nota ? `${nota.tipo === "ok" ? "✓ " : "⚠ "}${nota.texto}` : ""}
      </p>
    </section>
  );
}

function ChargeRow({
  c,
  trabajando,
  enCurso,
  onConfirmar,
  onOmitir,
  onBaja,
}: {
  c: PendingCharge;
  trabajando: boolean;
  enCurso: boolean;
  onConfirmar: () => void;
  onOmitir: () => void;
  onBaja: () => void;
}) {
  const [confirmandoBaja, setConfirmandoBaja] = useState(false);

  return (
    <div
      style={{
        display: "grid",
        gap: "0.6rem",
        padding: "0.8rem 0.95rem",
        background: "rgba(47,169,255,.05)",
        border: "1px solid rgba(47,169,255,.16)",
        borderRadius: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: "0.25rem", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" }}>
            <Link href={`/servicios/${c.serviceId}`} style={{ fontWeight: 600 }}>
              {c.serviceName}
            </Link>
            {c.categoryName && <CategoryTag name={c.categoryName} color={c.categoryColor ?? "#6b7280"} />}
            <span
              className="badge"
              style={
                c.auto
                  ? { background: "rgba(148,163,184,.12)", color: "var(--text-muted)" }
                  : { background: "rgba(251,191,36,.12)", color: "#fbbf24" }
              }
            >
              {c.auto ? "🔄 Se debitó solo" : "✋ Lo pagás vos"}
            </span>
          </div>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", textTransform: "capitalize" }}>
            {c.periodo} · cobro del {formatDate(c.cycleDate)}
            {c.overdueDays > 0 && (
              <span style={{ color: c.overdueDays > 40 ? "#f87171" : "var(--text-faint)" }}>
                {" "}· hace {c.overdueDays} días
              </span>
            )}
          </span>
        </div>
        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <div style={{ fontWeight: 700, fontSize: "1.02rem" }}>
            {c.amount != null ? formatMoney(c.amount, c.currency) : "sin monto"}
          </div>
          <div style={{ fontSize: "0.72rem", color: "var(--text-faint)" }}>estimado del servicio</div>
        </div>
      </div>

      {c.duplicate && (
        <p
          style={{
            margin: 0,
            fontSize: "0.78rem",
            color: "#fbbf24",
            background: "rgba(251,191,36,.07)",
            border: "1px solid rgba(251,191,36,.22)",
            borderRadius: 9,
            padding: "0.45rem 0.65rem",
          }}
        >
          ⚠ Ya hay un pago de este servicio el {formatDate(c.duplicate.date)} por{" "}
          {formatMoney(c.duplicate.amount, c.duplicate.currency)}. Si es este mismo cobro, omitilo en
          vez de confirmarlo (si no, queda duplicado).
        </p>
      )}

      {c.mesYaRendido && (
        <p style={{ margin: 0, fontSize: "0.78rem", color: "#fbbf24" }}>
          ⚠ {c.periodo} ya tiene pagos rendidos al contador. Si confirmás, este gasto queda fuera de
          esa rendición y hay que presentarlo aparte.
        </p>
      )}

      <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-primary"
          style={{ padding: "0.35rem 0.8rem", fontSize: "0.8rem" }}
          disabled={trabajando || c.amount == null}
          onClick={onConfirmar}
          title={c.amount == null ? "El servicio no tiene monto estimado" : undefined}
        >
          {enCurso ? "…" : "✓ Confirmar"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ padding: "0.35rem 0.8rem", fontSize: "0.8rem" }}
          disabled={trabajando}
          onClick={onOmitir}
        >
          Omitir este período
        </button>
        {confirmandoBaja ? (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: "0.35rem 0.8rem", fontSize: "0.8rem", color: "#f87171", borderColor: "#f8717155" }}
              disabled={trabajando}
              onClick={onBaja}
            >
              Sí, darlo de baja
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: "0.35rem 0.8rem", fontSize: "0.8rem" }}
              onClick={() => setConfirmandoBaja(false)}
            >
              No
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "0.35rem 0.8rem", fontSize: "0.8rem", color: "var(--text-muted)" }}
            disabled={trabajando}
            onClick={() => setConfirmandoBaja(true)}
          >
            Ya no lo usamos
          </button>
        )}
        {c.amount == null && (
          <Link
            href={`/servicios/${c.serviceId}`}
            className="btn btn-ghost"
            style={{ padding: "0.35rem 0.8rem", fontSize: "0.8rem" }}
          >
            Cargar monto →
          </Link>
        )}
      </div>
    </div>
  );
}
