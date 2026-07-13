import Link from "next/link";
import { listServices } from "@/lib/data";
import { formatMoney, formatDate, daysUntil } from "@/lib/utils";
import { ServiceStatusBadge, CategoryTag } from "@/components/badges";
import { BILLING_CYCLE_LABELS } from "@/lib/types";

export default async function ServiciosPage() {
  const services = await listServices();
  const active = services.filter((s) => s.status === "active");

  return (
    <div style={{ display: "grid", gap: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 style={{ fontSize: "1.9rem", fontWeight: 700 }}>Servicios</h1>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: "0.2rem" }}>
            {active.length} activos de {services.length} totales
          </p>
        </div>
        <Link href="/servicios/nuevo" className="btn btn-primary">+ Nuevo servicio</Link>
      </div>

      {services.length === 0 ? (
        <div className="card" style={{ padding: "2.5rem", textAlign: "center", color: "var(--text-muted)" }}>
          Todavía no cargaste servicios.{" "}
          <Link href="/servicios/nuevo" style={{ color: "var(--primary)" }}>Creá el primero.</Link>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1.25rem" }}>
          {services.map((s) => {
            const d = daysUntil(s.next_renewal_date);
            return (
              <Link key={s.id} href={`/servicios/${s.id}`} className="card" style={{ padding: "1.5rem", display: "grid", gap: "0.85rem", opacity: s.status === "cancelled" ? 0.6 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "0.5rem" }}>
                  <span style={{ fontWeight: 600, fontSize: "1.02rem" }}>{s.name}</span>
                  <ServiceStatusBadge status={s.status} />
                </div>
                {s.category && <div><CategoryTag name={s.category.name} color={s.category.color} /></div>}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>{BILLING_CYCLE_LABELS[s.billing_cycle]}</span>
                  <span style={{ fontWeight: 600 }}>{formatMoney(s.expected_amount, s.currency)}</span>
                </div>
                <div>
                  <span
                    className="badge"
                    style={
                      s.billing_cycle === "on_demand"
                        ? { background: "rgba(103,232,249,.1)", color: "#67e8f9", border: "1px solid rgba(103,232,249,.2)" }
                        : s.payment_mode === "manual"
                        ? { background: "rgba(251,191,36,.12)", color: "#fbbf24", border: "1px solid rgba(251,191,36,.25)" }
                        : { background: "rgba(148,163,184,.1)", color: "var(--text-muted)" }
                    }
                  >
                    {s.billing_cycle === "on_demand"
                      ? "⚡ Créditos — se carga a demanda"
                      : s.payment_mode === "manual"
                      ? "✋ Pago manual — con alerta"
                      : "🔄 Débito automático"}
                  </span>
                </div>
                <div style={{ borderTop: "1px solid var(--glass-border)", paddingTop: "0.6rem", fontSize: "0.8rem", color: "var(--text-muted)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>
                    {s.billing_cycle === "on_demand"
                      ? "Sin fecha fija de cobro"
                      : `Renueva: ${formatDate(s.next_renewal_date)}`}
                  </span>
                  {s.billing_cycle !== "on_demand" && s.status === "active" && d !== null && d <= 30 && (
                    <span className="badge" style={{ background: d <= 3 ? "rgba(239,68,68,.15)" : "rgba(245,158,11,.15)", color: d <= 3 ? "#f87171" : "#fbbf24" }}>
                      {d < 0 ? `Vencido ${-d}d` : d === 0 ? "Hoy" : `${d}d`}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
