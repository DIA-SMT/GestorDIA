import Link from "next/link";
import { monthPaidPayments, listServices, recentPayments as fetchRecent } from "@/lib/data";
import { formatMoney, formatDate, daysUntil, effectiveRenewal, toARS } from "@/lib/utils";
import { PaymentStatusBadge, CategoryTag } from "@/components/badges";
import KpiCards, { type KpiDef } from "@/components/kpi-cards";
import { BILLING_CYCLE_LABELS, type Payment, type Service } from "@/lib/types";

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
  // manual = lo tenés que pagar vos (alerta, incluye vencidos) /
  // automatic = se debita solo (informativo, usa el próximo cobro futuro)
  const withRenewal = activeServices.map((s) => {
    const date = effectiveRenewal(s.next_renewal_date, s.billing_cycle, s.payment_mode);
    return { s, date, d: date == null ? null : daysUntil(date) };
  });
  const toPayManually = withRenewal.filter(
    (r) => r.s.payment_mode === "manual" && r.d != null && r.d <= 30
  );
  const autoDebit = withRenewal.filter(
    (r) => r.s.payment_mode !== "manual" && r.d != null && r.d >= 0 && r.d <= 30
  );

  return (
    <div style={{ display: "grid", gap: "2.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}>
        <h1 style={{ fontSize: "1.9rem", fontWeight: 700 }}>Dashboard</h1>
        <Link href="/pagos/nuevo" className="btn btn-primary">
          + Registrar pago
        </Link>
      </div>

      {/* KPIs con detalle expandible para verificar los números */}
      <KpiCards
        kpis={[
          {
            key: "ars",
            label: "Gasto del mes (ARS)",
            value: formatMoney(monthTotalARS, "ARS"),
            hint: `${monthPayments.length} pagos este mes`,
            note: "Suma de los pagos confirmados del mes, convertidos a ARS con la cotización cargada en cada pago. Los que no tienen cotización no entran en la suma.",
            rows: monthPayments.map((p) => paymentRow(p)),
          },
          {
            key: "usd",
            label: "Gasto del mes (USD)",
            value: formatMoney(monthTotalUSD, "USD"),
            hint: "Solo pagos en dólares",
            note: "Suma de los pagos confirmados del mes hechos en dólares, en su monto original.",
            rows: monthPayments.filter((p) => p.currency === "USD").map((p) => ({
              ...paymentRow(p),
              amount: formatMoney(Number(p.amount), "USD"),
              warn: false,
            })),
          },
          {
            key: "manual",
            label: "Para pagar vos",
            value: String(toPayManually.length),
            hint: "Pagos manuales en 30 días",
            accent: toPayManually.length > 0,
            note: "Servicios activos de pago manual que renuevan en los próximos 30 días (o ya vencieron).",
            rows: toPayManually.map(({ s }) => serviceRow(s)),
          },
          {
            key: "auto",
            label: "Se debitan solos",
            value: String(autoDebit.length),
            hint: "Débitos automáticos en 30 días",
            note: "Servicios activos con débito automático. Muestra el próximo cobro (los ya debitados se adelantan al siguiente).",
            rows: autoDebit.map(({ s }) => serviceRow(s)),
          },
        ] satisfies KpiDef[]}
      />

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
            {toPayManually.map(({ s, date, d }) => {
              const dd = d ?? 0;
              return (
                <div key={s.id} style={{ ...rowStyle, background: "rgba(251,191,36,.06)", border: "1px solid rgba(251,191,36,.15)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{s.name}</span>
                    {s.category && <CategoryTag name={s.category.name} color={s.category.color} />}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: "1rem" }}>
                      {formatMoney(s.expected_amount, s.currency)}{" "}
                      <span style={{ fontWeight: 400, fontSize: "0.72rem", color: "var(--text-faint)" }}>estimado</span>
                    </span>
                    <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                      {formatDate(date)} · {BILLING_CYCLE_LABELS[s.billing_cycle]}
                    </span>
                    <span
                      className="badge"
                      style={{
                        background: dd <= 3 ? "rgba(239,68,68,.18)" : "rgba(251,191,36,.15)",
                        color: dd <= 3 ? "#f87171" : "#fbbf24",
                      }}
                    >
                      {dd < 0 ? `Venció hace ${-dd}d` : dd === 0 ? "¡Vence hoy!" : `En ${dd} días`}
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
            {autoDebit.map(({ s, date, d }) => {
              const dd = d ?? 0;
              return (
                <div key={s.id} style={rowStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 }}>
                    <span style={{ fontWeight: 500 }}>{s.name}</span>
                    {s.category && <CategoryTag name={s.category.name} color={s.category.color} />}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                    <span style={{ fontWeight: 600 }}>
                      {formatMoney(s.expected_amount, s.currency)}{" "}
                      <span style={{ fontWeight: 400, fontSize: "0.72rem", color: "var(--text-faint)" }}>estimado</span>
                    </span>
                    <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                      {formatDate(date)} · {BILLING_CYCLE_LABELS[s.billing_cycle]}
                    </span>
                    <span className="badge" style={{ background: "rgba(148,163,184,.12)", color: "var(--text-muted)" }}>
                      {dd === 0 ? "Hoy" : `En ${dd} días`}
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

// Fila de detalle de un pago del mes: muestra la conversión a ARS usada en la suma
function paymentRow(p: Payment) {
  const ars = toARS(Number(p.amount), p.currency, p.exchange_rate);
  return {
    id: p.id,
    href: `/pagos/${p.id}`,
    title: p.description || p.service?.name || p.provider || "Pago",
    meta: `${formatDate(p.payment_date)} · ${formatMoney(Number(p.amount), p.currency)}${
      p.currency !== "ARS" && p.exchange_rate ? ` × $${p.exchange_rate}` : ""
    }`,
    amount: ars == null ? "sin cotización" : formatMoney(ars, "ARS"),
    warn: ars == null,
  };
}

// Fila de detalle de un servicio con renovación próxima
function serviceRow(s: Service) {
  const date = effectiveRenewal(s.next_renewal_date, s.billing_cycle, s.payment_mode);
  const d = daysUntil(date);
  return {
    id: s.id,
    href: `/servicios/${s.id}`,
    title: s.name,
    meta: `${formatDate(date)} · ${BILLING_CYCLE_LABELS[s.billing_cycle]}${
      d == null ? "" : d < 0 ? ` · venció hace ${-d}d` : d === 0 ? " · vence hoy" : ` · en ${d}d`
    }`,
    amount: s.expected_amount != null ? `${formatMoney(s.expected_amount, s.currency)} estimado` : "—",
  };
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", padding: "0.5rem 0" }}>{children}</p>
  );
}
