import Link from "next/link";
import {
  monthPaidPayments,
  listServices,
  listPendientesDeRendir,
  listPaymentsBetween,
  recentPayments as fetchRecent,
} from "@/lib/data";
import { formatMoney, formatDate, toARS, todayISO, monthLabel, shiftMonth, monthOf } from "@/lib/utils";
import { gastosSinCargarEsteMes, desdeCuando, VENTANA_MESES } from "@/lib/gastos-habituales";
import { PaymentStatusBadge, CategoryTag } from "@/components/badges";
import KpiCards, { type KpiDef } from "@/components/kpi-cards";
import { resumirPreparacion } from "@/lib/rendicion-status";
import type { Payment } from "@/lib/types";

// Lo que se muestra depende de qué día es hoy. Sin esto Next puede
// prerenderizar la página en el build con un "hoy" congelado.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const mes = todayISO().slice(0, 7);
  const monthStart = `${mes}-01`;

  const [monthPayments, services, recientes, pendientes, ventana] = await Promise.all([
    monthPaidPayments(monthStart),
    listServices(),
    fetchRecent(8),
    listPendientesDeRendir(),
    // Ventana de varios meses + el mes actual, en una sola consulta
    listPaymentsBetween(`${shiftMonth(mes, -VENTANA_MESES)}-01`, `${shiftMonth(mes, 1)}-01`),
  ]);

  // Gasto del mes en ARS (suma de equivalentes)
  const monthTotalARS = monthPayments.reduce(
    (acc, p) => acc + (toARS(Number(p.amount), p.currency, p.exchange_rate) ?? 0),
    0
  );
  const monthTotalUSD = monthPayments
    .filter((p) => p.currency === "USD")
    .reduce((acc, p) => acc + Number(p.amount), 0);

  const porRendir = pendientes.filter((p) => p.status === "paid");
  const totalPorRendir = porRendir.reduce(
    (acc, p) => acc + (toARS(Number(p.amount), p.currency, p.exchange_rate) ?? 0),
    0
  );
  const prep = resumirPreparacion(porRendir);
  const arrastres = porRendir.filter((p) => p.payment_date.slice(0, 7) < mes).length;
  const activos = services.filter((s) => s.status === "active");

  // Lo que venís pagando y este mes todavía no cargaste. Como los gastos ya no
  // se generan solos, este es el recordatorio — con el monto REAL de la última
  // vez, no con una estimación.
  const habituales = gastosSinCargarEsteMes({
    historial: ventana.filter((p) => monthOf(p.payment_date) < mes),
    delMesActual: ventana.filter((p) => monthOf(p.payment_date) === mes),
    mesActual: mes,
    serviciosCancelados: new Set(services.filter((s) => s.status === "cancelled").map((s) => s.id)),
  });

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
            hint: `${monthPayments.length} pagos en ${monthLabel(mes)}`,
            note: "Suma de los pagos confirmados del mes, convertidos a ARS con la cotización cargada en cada pago. Los que no tienen cotización no entran en la suma.",
            rows: monthPayments.map((p) => paymentRow(p)),
          },
          {
            key: "usd",
            label: "Gasto del mes (USD)",
            value: formatMoney(monthTotalUSD, "USD"),
            hint: "Solo pagos en dólares",
            note: "Suma de los pagos confirmados del mes hechos en dólares, en su monto original.",
            rows: monthPayments
              .filter((p) => p.currency === "USD")
              .map((p) => ({ ...paymentRow(p), amount: formatMoney(Number(p.amount), "USD"), warn: false })),
          },
          {
            key: "rendir",
            label: "Pendiente de rendir",
            value: formatMoney(totalPorRendir, "ARS"),
            hint: `${porRendir.length} ${porRendir.length === 1 ? "pago" : "pagos"}${
              arrastres > 0 ? ` · ${arrastres} de meses anteriores` : ""
            }`,
            accent: arrastres > 0,
            note: "Pagos confirmados que todavía no se le entregaron al contador, de cualquier período. Se arman en Rendición.",
            rows: porRendir.map((p) => paymentRow(p)),
          },
          {
            key: "facturas",
            label: "Sin factura cargada",
            value: `${prep.sinDatos}`,
            hint: prep.sinDatos > 0 ? "El contador los va a rebotar" : "Todo con su comprobante",
            accent: prep.sinDatos > 0,
            note: "Pagos pendientes de rendir a los que les falta el tipo de comprobante, el número o el archivo adjunto. Se completan desde Rendición, con el lápiz de cada fila.",
            rows: porRendir.map((p) => paymentRow(p)),
          },
          {
            key: "servicios",
            label: "Servicios activos",
            value: String(activos.length),
            hint: `de ${services.length} cargados`,
            note: "Los servicios agrupan pagos: sirven para ver el historial y el total gastado en cada uno.",
            rows: activos.map((s) => ({ id: s.id, href: `/servicios/${s.id}`, title: s.name, meta: s.description ?? "", amount: "" })),
          },
        ] satisfies KpiDef[]}
      />

      {/* Lo que venís pagando y este mes todavía no cargaste */}
      {habituales.length > 0 && (
        <section className="card" style={{ padding: "1.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem", flexWrap: "wrap", gap: "0.5rem" }}>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 600 }}>
              Venís pagando esto y en {monthLabel(mes)} todavía no lo cargaste
            </h2>
            <Link href="/pagos" style={{ fontSize: "0.85rem", color: "var(--primary)" }}>Ver pagos →</Link>
          </div>
          <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "1rem" }}>
            El monto es <strong style={{ color: "var(--text)" }}>el de la última vez</strong>, no una estimación: casi
            siempre cambia. “Repetir” abre el formulario con todos los datos cargados y la fecha de hoy, para que
            solo corrijas el importe.
          </p>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {habituales.map((g) => {
              const p = g.pago;
              const atrasado = g.mesesDesde >= 2;
              return (
                <div
                  key={p.id}
                  style={{
                    ...rowStyle,
                    ...(atrasado
                      ? { background: "rgba(251,191,36,.06)", border: "1px solid rgba(251,191,36,.18)" }
                      : null),
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0, flexWrap: "wrap" }}>
                    <Link href={`/pagos/${p.id}`} style={{ fontWeight: 500, color: "var(--text)" }}>
                      {p.description || p.service?.name || p.provider || "Pago"}
                    </Link>
                    {p.category && <CategoryTag name={p.category.name} color={p.category.color} />}
                    {g.habitual && (
                      <span className="badge" style={{ background: "rgba(148,163,184,.12)", color: "var(--text-muted)" }}>
                        {g.veces} de los últimos {VENTANA_MESES} meses
                      </span>
                    )}
                    {atrasado && (
                      <span className="badge" style={{ background: "rgba(251,191,36,.15)", color: "#fbbf24" }}>
                        sin cargar desde {desdeCuando(g.mesesDesde)}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                      última vez el {formatDate(g.ultimaFecha)}
                    </span>
                    <span style={{ fontWeight: 600, minWidth: 90, textAlign: "right" }}>
                      {formatMoney(g.ultimoMonto, p.currency)}
                    </span>
                    <Link
                      href={`/pagos/nuevo?repetir=${p.id}`}
                      className="btn btn-primary"
                      style={{ padding: "0.3rem 0.7rem", fontSize: "0.78rem" }}
                    >
                      ↻ Repetir
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Últimos pagos */}
      <section className="card" style={{ padding: "1.75rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 600 }}>Últimos pagos</h2>
          <Link href="/pagos" style={{ fontSize: "0.85rem", color: "var(--primary)" }}>Ver todos →</Link>
        </div>
        {recientes.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", padding: "0.5rem 0" }}>
            Todavía no cargaste ningún pago.{" "}
            <Link href="/pagos/nuevo" style={{ color: "var(--primary)" }}>Registrá el primero.</Link>
          </p>
        ) : (
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {recientes.map((p) => (
              <div key={p.id} style={rowStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 }}>
                  <Link href={`/pagos/${p.id}`} style={{ fontWeight: 500, color: "var(--text)" }}>
                    {p.description || p.service?.name || "Pago"}
                  </Link>
                  {p.category && <CategoryTag name={p.category.name} color={p.category.color} />}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{formatDate(p.payment_date)}</span>
                  <span style={{ fontWeight: 600, minWidth: 90, textAlign: "right" }}>
                    {formatMoney(p.amount, p.currency)}
                  </span>
                  <PaymentStatusBadge status={p.status} />
                  <Link
                    href={`/pagos/nuevo?repetir=${p.id}`}
                    className="btn btn-ghost"
                    style={{ padding: "0.25rem 0.6rem", fontSize: "0.76rem" }}
                    title="Cargar otro pago igual a este"
                  >
                    ↻
                  </Link>
                </div>
              </div>
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

// Fila de detalle de un pago: muestra la conversión a ARS usada en la suma
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
