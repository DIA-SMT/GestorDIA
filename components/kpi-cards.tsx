"use client";

// Tarjetas KPI del dashboard con detalle expandible: al clickear una,
// se abre un panel abajo con los ítems que componen ese número, para
// poder verificar que esté bien calculado.

import { useState } from "react";
import Link from "next/link";

export interface KpiDetailRow {
  id: string;
  href: string;
  title: string;
  meta: string; // fecha, monto original, ciclo, etc.
  amount: string; // lo que suma al total (o aclaración)
  warn?: boolean; // ej: pago sin cotización que no entra en la suma
}

export interface KpiDef {
  key: string;
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  note: string; // cómo se calcula, en una línea
  rows: KpiDetailRow[];
}

export default function KpiCards({ kpis }: { kpis: KpiDef[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const active = kpis.find((k) => k.key === open);

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1.25rem" }}>
        {kpis.map((k) => {
          const isOpen = open === k.key;
          return (
            <button
              key={k.key}
              type="button"
              className="card"
              onClick={() => setOpen(isOpen ? null : k.key)}
              aria-expanded={isOpen}
              style={{
                padding: "1.5rem",
                textAlign: "left",
                cursor: "pointer",
                borderColor: isOpen ? "rgba(77, 163, 255, 0.55)" : k.accent ? "#f59e0b55" : undefined,
                background: isOpen ? "var(--glass-strong)" : undefined,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{k.label}</span>
                <span aria-hidden style={{ fontSize: "0.7rem", color: "var(--text-faint)", transform: isOpen ? "rotate(180deg)" : undefined, transition: "transform 0.15s ease" }}>
                  ▼
                </span>
              </div>
              <div style={{ fontSize: "1.6rem", fontWeight: 700, marginTop: "0.3rem", color: "var(--text)" }}>{k.value}</div>
              {k.hint && <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>{k.hint}</div>}
            </button>
          );
        })}
      </div>

      {active && (
        <div className="card" style={{ padding: "1.25rem 1.5rem", borderColor: "rgba(77, 163, 255, 0.35)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "1rem", marginBottom: "0.9rem" }}>
            <div>
              <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: 0 }}>{active.label} — detalle</h3>
              <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0.25rem 0 0" }}>{active.note}</p>
            </div>
            <button type="button" className="btn btn-ghost" style={{ padding: "0.3rem 0.65rem", fontSize: "0.78rem" }} onClick={() => setOpen(null)}>
              Cerrar ✕
            </button>
          </div>

          {active.rows.length === 0 ? (
            <p style={{ color: "var(--text-faint)", fontSize: "0.85rem", margin: 0 }}>No hay ítems que compongan este número.</p>
          ) : (
            <div style={{ display: "grid", gap: "0.4rem" }}>
              {active.rows.map((r) => (
                <Link
                  key={r.id}
                  href={r.href}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "1rem",
                    padding: "0.55rem 0.75rem",
                    background: "rgba(255,255,255,0.04)",
                    borderRadius: "0.5rem",
                    fontSize: "0.86rem",
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", minWidth: 0, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 500 }}>{r.title}</span>
                    <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{r.meta}</span>
                  </span>
                  <span style={{ fontWeight: 600, color: r.warn ? "#fbbf24" : "var(--text)", whiteSpace: "nowrap" }}>
                    {r.amount}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
