import Link from "next/link";
import { listServices, servicePaidTotals } from "@/lib/data";
import { formatMoney } from "@/lib/utils";
import { ServiceStatusBadge, CategoryTag } from "@/components/badges";

export default async function ServiciosPage() {
  const [services, spendByService] = await Promise.all([listServices(), servicePaidTotals()]);
  const active = services.filter((s) => s.status === "active");

  return (
    <div style={{ display: "grid", gap: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 style={{ fontSize: "1.9rem", fontWeight: 700 }}>Servicios</h1>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: "0.2rem" }}>
            Agrupan los pagos para ver el historial y el total gastado en cada uno · {active.length} activos de{" "}
            {services.length}
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1.25rem" }}>
          {services.map((s) => {
            const spend = spendByService[s.id] ?? [];
            return (
              <Link
                key={s.id}
                href={`/servicios/${s.id}`}
                className="card"
                style={{ padding: "1.5rem", display: "grid", gap: "0.85rem", opacity: s.status === "cancelled" ? 0.6 : 1 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "0.5rem" }}>
                  <span style={{ fontWeight: 600, fontSize: "1.02rem" }}>{s.name}</span>
                  <ServiceStatusBadge status={s.status} />
                </div>
                {s.category && <div><CategoryTag name={s.category.name} color={s.category.color} /></div>}
                {s.description && (
                  <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: 0 }}>{s.description}</p>
                )}
                <div
                  style={{
                    borderTop: "1px solid var(--glass-border)",
                    paddingTop: "0.7rem",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    fontSize: "0.85rem",
                    gap: "0.5rem",
                  }}
                >
                  <span style={{ color: "var(--text-muted)" }}>Gastado</span>
                  {spend.length > 0 ? (
                    <span style={{ fontWeight: 600, textAlign: "right" }}>
                      {spend.map((t) => formatMoney(t.total, t.currency)).join(" + ")}
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-faint)" }}>Sin pagos aún</span>
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
