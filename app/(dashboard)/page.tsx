import Link from "next/link";
import {
  monthPaidPayments,
  listServices,
  listPendientesDeRendir,
  listPaymentsBetween,
  recentPayments as fetchRecent,
} from "@/lib/data";
import { formatMoney, formatDate, toARS, todayISO, monthLabel, prevMonth, claveDeGasto } from "@/lib/utils";
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
  const anterior = prevMonth(mes);

  const [monthPayments, services, recientes, pendientes, delMesPasado] = await Promise.all([
    monthPaidPayments(monthStart),
    listServices(),
    fetchRecent(8),
    listPendientesDeRendir(),
    listPaymentsBetween(`${anterior}-01`, monthStart),
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

  // Gastos del mes pasado que todavía no se repitieron este mes. Como ahora
  // cada gasto se carga a mano, esto es el recordatorio: "esto lo pagaste en
  // julio y en agosto todavía no aparece". Se compara por proveedor+descripción,
  // que es lo que identifica al gasto cuando el monto cambia todos los meses.
  const yaCargados = new Set(monthPayments.map(claveDeGasto));
  const sinRepetir = dedupe(delMesPasado.filter((p) => p.status === "paid" && !yaCargados.has(claveDeGasto(p))));

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

      {/* Gastos del mes pasado que todavía no se repitieron este mes */}
      {sinRepetir.length > 0 && (
        <section className="card" style={{ padding: "1.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem", flexWrap: "wrap", gap: "0.5rem" }}>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 600 }}>
              Pagaste esto en {monthLabel(anterior)} y todavía no en {monthLabel(mes)}
            </h2>
            <Link href="/pagos" style={{ fontSize: "0.85rem", color: "var(--primary)" }}>Ver pagos →</Link>
          </div>
          <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "1rem" }}>
            No es una alerta: puede que este mes no corresponda. “Repetir” abre el formulario con los mismos datos y
            la fecha de hoy, para que solo ajustes el monto.
          </p>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {sinRepetir.map((p) => (
              <div key={p.id} style={rowStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 }}>
                  <Link href={`/pagos/${p.id}`} style={{ fontWeight: 500, color: "var(--text)" }}>
                    {p.description || p.service?.name || p.provider || "Pago"}
                  </Link>
                  {p.category && <CategoryTag name={p.category.name} color={p.category.color} />}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{formatDate(p.payment_date)}</span>
                  <span style={{ fontWeight: 600, minWidth: 90, textAlign: "right" }}>
                    {formatMoney(p.amount, p.currency)}
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
            ))}
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

// Un mismo gasto puede tener varios pagos el mes pasado; para sugerir repetir
// alcanza con uno por proveedor+descripción.
function dedupe(pagos: Payment[]): Payment[] {
  const vistos = new Set<string>();
  const out: Payment[] = [];
  for (const p of pagos) {
    const k = claveDeGasto(p);
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(p);
  }
  return out;
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
