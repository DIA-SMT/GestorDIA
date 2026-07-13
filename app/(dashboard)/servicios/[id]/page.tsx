import Link from "next/link";
import { notFound } from "next/navigation";
import { getService, listCategories, getServicePayments } from "@/lib/data";
import ServiceForm from "@/components/service-form";
import { updateService, deleteService } from "../actions";
import { formatMoney, formatDate, toARS } from "@/lib/utils";
import { PaymentStatusBadge } from "@/components/badges";

export default async function ServicioDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [s, categories, pays] = await Promise.all([
    getService(id),
    listCategories(),
    getServicePayments(id),
  ]);

  if (!s) notFound();
  const totalARS = pays
    .filter((p) => p.status === "paid")
    .reduce((acc, p) => acc + (toARS(Number(p.amount), p.currency, p.exchange_rate) ?? 0), 0);

  const boundUpdate = updateService.bind(null, id);
  const boundDelete = deleteService.bind(null, id);

  return (
    <div style={{ display: "grid", gap: "2rem", maxWidth: 900 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <Link href="/servicios" style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>← Servicios</Link>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: "0.4rem" }}>{s.name}</h1>
          {s.url && (
            <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)", fontSize: "0.85rem" }}>
              {s.url} ↗
            </a>
          )}
        </div>
        <form action={boundDelete}>
          <button type="submit" className="btn btn-ghost" style={{ color: "#f87171", borderColor: "#f8717155" }}>
            Eliminar
          </button>
        </form>
      </div>

      {/* Historial de pagos del servicio */}
      <section className="card" style={{ padding: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.9rem" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600 }}>
            Historial de pagos ({pays.length}) · {formatMoney(totalARS, "ARS")}
          </h2>
          <Link href="/pagos/nuevo" className="btn btn-primary" style={{ padding: "0.4rem 0.7rem", fontSize: "0.82rem" }}>
            + Registrar pago
          </Link>
        </div>
        {pays.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.88rem" }}>Sin pagos registrados para este servicio.</p>
        ) : (
          <div style={{ display: "grid", gap: "0.4rem" }}>
            {pays.map((p) => (
              <Link key={p.id} href={`/pagos/${p.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.55rem 0.75rem", background: "rgba(255,255,255,0.045)", borderRadius: "0.5rem", fontSize: "0.88rem" }}>
                <span style={{ color: "var(--text-muted)" }}>{formatDate(p.payment_date)}</span>
                <span style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
                  <span style={{ fontWeight: 600 }}>{formatMoney(p.amount, p.currency)}</span>
                  <PaymentStatusBadge status={p.status} />
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Editar */}
      <section className="card" style={{ padding: "2rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>Editar servicio</h2>
        <ServiceForm
          action={boundUpdate}
          categories={categories}
          service={s}
          submitLabel="Guardar cambios"
        />
      </section>
    </div>
  );
}
