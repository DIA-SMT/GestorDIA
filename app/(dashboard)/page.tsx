import Link from "next/link";
import { monthPaidPayments, listServices, recentPayments as fetchRecent } from "@/lib/data";
import { formatMoney, formatDate, daysUntil, toARS } from "@/lib/utils";
import { PaymentStatusBadge, CategoryTag } from "@/components/badges";
import { BILLING_CYCLE_LABELS } from "@/lib/types";

export default async function DashboardPage() {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const [monthPayments, allServices, recentPayments] = await Promise.all([
    monthPaidPayments(monthStart),
    listServices(),
    fetchRecent(8),
  ]);

  const activeServices = allServices.filter(
    (s) => s.status === "active" && s.next_renewal_date
  );

  // Gasto del mes en ARS (suma de equivalentes)
  const monthTotalARS = monthPayments.reduce((acc, p) => {
    const ars = toARS(Number(p.amount), p.currency, p.exchange_rate);
    return acc + (ars ?? 0);
  }, 0);
  const monthTotalUSD = monthPayments
    .filter((p) => p.currency === "USD")
    .reduce((acc, p) => acc + Number(p.amount), 0);

  // Próximos vencimientos (30 días), separados por cómo se pagan:
  // manual = lo tenés que pagar vos (alerta) / automatic = se debita solo (informativo)
  const upcoming = activeServices.filter((s) => {
    const d = daysUntil(s.next_renewal_date);
    return d !== null && d <= 30;
  });
  const toPayManually = upcoming.filter((s) => s.payment_mode === "manual");
  const autoDebit = upcoming.filter((s) => s.payment_mode !== "manual");

  return (
    <div style={{ display: "grid", gap: "2.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}>
        <h1 style={{ fontSize: "1.9rem", fontWeight: 700 }}>Dashboard</h1>
        <Link href="/pagos/nuevo" className="btn btn-primary">
          + Registrar pago
        </Link>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1.25rem" }}>
        <Kpi label="Gasto del mes (ARS)" value={formatMoney(monthTotalARS, "ARS")} hint={`${monthPayments.length} pagos este mes`} />
        <Kpi label="Gasto del mes (USD)" value={formatMoney(monthTotalUSD, "USD")} hint="Solo pagos en dólares" />
        <Kpi label="Para pagar vos" value={String(toPayManually.length)} hint="Pagos manuales en 30 días" accent={toPayManually.length > 0} />
        <Kpi label="Se debitan solos" value={String(autoDebit.length)} hint="Débitos automáticos en 30 días" />
      </div>

      {/* ⚠ Alertas: pagos manuales que tenés que hacer vos */}
      {toPayManually.length > 0 && (
        <section
          className="card"
          style={{ padding: "1.75rem", borderColor: "rgba(251,191,36,.35)" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 600, color: "#fbbf24" }}>
              ⚠ Tenés que pagarlos vos
            </h2>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              No se debitan solos — registrá el pago cuando lo hagas
            </span>
          </div>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {toPayManually.map((s) => {
              const d = daysUntil(s.next_renewal_date)!;
              return (
                <div key={s.id} style={{ ...rowStyle, background: "rgba(251,191,36,.06)", border: "1px solid rgba(251,191,36,.15)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{s.name}</span>
                    {s.category && <CategoryTag name={s.category.name} color={s.category.color} />}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: "1rem" }}>
                      {formatMoney(s.expected_amount, s.currency)}
                    </span>
                    <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                      {formatDate(s.next_renewal_date)} · {BILLING_CYCLE_LABELS[s.billing_cycle]}
                    </span>
                    <span
                      className="badge"
                      style={{
                        background: d <= 3 ? "rgba(239,68,68,.18)" : "rgba(251,191,36,.15)",
                        color: d <= 3 ? "#f87171" : "#fbbf24",
                      }}
                    >
                      {d < 0 ? `Venció hace ${-d}d` : d === 0 ? "¡Vence hoy!" : `En ${d} días`}
                    </span>
                    <Link href="/pagos/nuevo" className="btn btn-primary" style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem" }}>
                      Ya lo pagué
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Débitos automáticos próximos (informativo) */}
      <section className="card" style={{ padding: "1.75rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 600 }}>Próximos débitos automáticos</h2>
          <Link href="/servicios" style={{ fontSize: "0.85rem", color: "var(--primary)" }}>Ver todos →</Link>
        </div>
        {autoDebit.length === 0 ? (
          <Empty>No hay débitos automáticos en los próximos 30 días.</Empty>
        ) : (
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {autoDebit.map((s) => {
              const d = daysUntil(s.next_renewal_date)!;
              return (
                <div key={s.id} style={rowStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 }}>
                    <span style={{ fontWeight: 500 }}>{s.name}</span>
                    {s.category && <CategoryTag name={s.category.name} color={s.category.color} />}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                    <span style={{ fontWeight: 600 }}>{formatMoney(s.expected_amount, s.currency)}</span>
                    <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                      {formatDate(s.next_renewal_date)} · {BILLING_CYCLE_LABELS[s.billing_cycle]}
                    </span>
                    <span className="badge" style={{ background: "rgba(148,163,184,.12)", color: "var(--text-muted)" }}>
                      {d < 0 ? `Hace ${-d}d` : d === 0 ? "Hoy" : `En ${d} días`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Últimos pagos */}
      <section className="card" style={{ padding: "1.75rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 600 }}>Últimos pagos</h2>
          <Link href="/pagos" style={{ fontSize: "0.85rem", color: "var(--primary)" }}>Ver todos →</Link>
        </div>
        {recentPayments.length === 0 ? (
          <Empty>Todavía no cargaste ningún pago. <Link href="/pagos/nuevo" style={{ color: "var(--primary)" }}>Registrá el primero.</Link></Empty>
        ) : (
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {recentPayments.map((p) => (
              <Link key={p.id} href={`/pagos/${p.id}`} style={rowStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 }}>
                  <span style={{ fontWeight: 500 }}>
                    {p.description || p.service?.name || "Pago"}
                  </span>
                  {p.category && <CategoryTag name={p.category.name} color={p.category.color} />}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{formatDate(p.payment_date)}</span>
                  <span style={{ fontWeight: 600, minWidth: 90, textAlign: "right" }}>
                    {formatMoney(p.amount, p.currency)}
                  </span>
                  <PaymentStatusBadge status={p.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "1rem",
  padding: "0.7rem 0.85rem",
  background: "rgba(255,255,255,0.045)",
  borderRadius: "0.6rem",
  flexWrap: "wrap",
};

function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="card" style={{ padding: "1.5rem", borderColor: accent ? "#f59e0b55" : undefined }}>
      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: "1.6rem", fontWeight: 700, marginTop: "0.3rem" }}>{value}</div>
      {hint && <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>{hint}</div>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", padding: "0.5rem 0" }}>{children}</p>
  );
}
