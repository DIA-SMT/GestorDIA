// Historial de rendiciones: cada entrega al contador, como un lote cerrado.
//
// Antes esto no existía. "Ver las rendiciones anteriores" era navegar mes a mes
// y mirar qué pagos tenían fecha de presentación, sin poder distinguir dos
// entregas del mismo mes ni reimprimir el papel exacto que se había firmado.

import Link from "next/link";
import { listRendiciones, hasRendicionesTable } from "@/lib/data";
import { formatMoney, formatDate, toLocalDay } from "@/lib/utils";
import { rangoLegible } from "@/lib/rendicion-doc";

export default async function HistorialPage() {
  const [rendiciones, migrado] = await Promise.all([listRendiciones(), hasRendicionesTable()]);

  const totalARS = rendiciones.reduce((a, r) => a + Number(r.total_ars), 0);
  const totalPagos = rendiciones.reduce((a, r) => a + r.cantidad, 0);

  return (
    <div style={{ display: "grid", gap: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "1.9rem", fontWeight: 700 }}>Rendiciones presentadas</h1>
          <p className="muted" style={{ fontSize: "0.88rem", marginTop: "0.25rem" }}>
            Cada entrega al contador, con su número, lo que incluía y el comprobante que se imprimió.
          </p>
        </div>
        <Link href="/rendicion" className="btn btn-ghost">← Armar una nueva</Link>
      </div>

      {!migrado && (
        <div className="card" style={{ padding: "0.9rem 1.15rem", borderColor: "rgba(251,191,36,.4)", background: "rgba(251,191,36,.06)", fontSize: "0.84rem" }}>
          ⚠ Falta correr <code>supabase/migrations/0005_rendiciones.sql</code>: hasta entonces no hay historial. Los pagos
          que marques quedan como rendidos, pero sueltos.
        </div>
      )}

      {rendiciones.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(196px, 1fr))", gap: "1rem" }}>
          <Kpi label="Rendiciones presentadas" value={String(rendiciones.length)} hint="Desde que se usa el sistema" />
          <Kpi label="Total rendido (ARS)" value={formatMoney(totalARS, "ARS")} hint="Suma de todas las entregas" />
          <Kpi label="Pagos rendidos" value={String(totalPagos)} hint="Comprobantes presentados" />
        </div>
      )}

      {rendiciones.length === 0 ? (
        <div className="card" style={{ padding: "2.5rem 1.25rem", textAlign: "center" }}>
          <p style={{ fontSize: "0.95rem", marginBottom: "0.35rem" }}>Todavía no cerraste ninguna rendición.</p>
          <p className="muted" style={{ fontSize: "0.83rem" }}>
            Armá la primera desde <Link href="/rendicion" style={{ color: "var(--text)" }}>Rendición</Link>: elegís los
            pagos y el botón “Rendir y generar comprobante” cierra el lote.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {rendiciones.map((r) => (
            <Link
              key={r.id}
              href={`/rendicion/${r.id}`}
              className="card"
              style={{
                padding: "1.1rem 1.25rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "1rem",
                flexWrap: "wrap",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "1rem", minWidth: 0 }}>
                <div
                  className="font-display"
                  style={{
                    fontSize: "1.15rem",
                    fontWeight: 700,
                    minWidth: 56,
                    textAlign: "center",
                    padding: "0.4rem 0.5rem",
                    borderRadius: 10,
                    border: "1px solid var(--glass-border-strong)",
                    color: "#2fa9ff",
                  }}
                  title="Número de rendición"
                >
                  {r.numero}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                    {r.titulo?.trim() || `Rendición N° ${r.numero}`}
                  </div>
                  <div className="muted" style={{ fontSize: "0.78rem", marginTop: 2 }}>
                    Presentada el {formatDate(toLocalDay(r.presentada_at))} · gastos del{" "}
                    {rangoLegible(r.periodo_desde, r.periodo_hasta)} · {r.cantidad}{" "}
                    {r.cantidad === 1 ? "pago" : "pagos"}
                  </div>
                  {r.notas && (
                    <div style={{ fontSize: "0.76rem", color: "var(--text-faint)", marginTop: 3 }}>{r.notas}</div>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="font-display" style={{ fontWeight: 700 }}>{formatMoney(Number(r.total_ars), "ARS")}</div>
                {Number(r.total_usd) > 0 && (
                  <div className="muted" style={{ fontSize: "0.78rem" }}>{formatMoney(Number(r.total_usd), "USD")}</div>
                )}
                <div style={{ fontSize: "0.72rem", color: r.pdf_path ? "#6ee7b7" : "var(--text-faint)", marginTop: 2 }}>
                  {r.pdf_path ? "📄 PDF archivado" : "sin PDF archivado"}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card" style={{ padding: "1.5rem" }}>
      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{label}</div>
      <div className="font-display" style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: "0.3rem" }}>{value}</div>
      {hint && <div style={{ fontSize: "0.74rem", color: "var(--text-faint)", marginTop: "0.25rem" }}>{hint}</div>}
    </div>
  );
}
