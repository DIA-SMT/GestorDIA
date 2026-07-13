import { listPaymentsBetween } from "@/lib/data";
import { formatMoney, formatDate, toARS } from "@/lib/utils";
import { PaymentStatusBadge, CategoryTag } from "@/components/badges";
import ExportCsv from "@/components/export-csv";
import {
  RECEIPT_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
  type Payment,
} from "@/lib/types";

function nextMonth(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

function monthLabel(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(d);
}

export default async function RendicionPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const sp = await searchParams;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? sp.mes! : currentMonth;

  const start = `${mes}-01`;
  const end = `${nextMonth(mes)}-01`;

  const payments = (await listPaymentsBetween(start, end)) as (Payment & {
    receipts?: { id: string }[];
  })[];

  const paid = payments.filter((p) => p.status === "paid");
  const totalARS = paid.reduce((a, p) => a + (toARS(Number(p.amount), p.currency, p.exchange_rate) ?? 0), 0);
  const totalUSD = paid.filter((p) => p.currency === "USD").reduce((a, p) => a + Number(p.amount), 0);
  const conComprobante = payments.filter((p) => p.receipt_type !== "sin_comprobante").length;
  const conRecibo = payments.filter((p) => (p.receipts?.length ?? 0) > 0).length;

  // Filas para el CSV (valores crudos, ideales para el contador)
  const csvRows = payments.map((p) => ({
    Fecha: p.payment_date,
    Proveedor: p.provider ?? "",
    CUIT: p.provider_tax_id ?? "",
    Descripcion: p.description ?? "",
    Categoria: p.category?.name ?? "",
    TipoComprobante: RECEIPT_TYPE_LABELS[p.receipt_type],
    NroComprobante: p.receipt_number ?? "",
    MedioPago: p.payment_method ?? "",
    Moneda: p.currency,
    Monto: Number(p.amount),
    Cotizacion: p.exchange_rate ?? "",
    MontoARS: toARS(Number(p.amount), p.currency, p.exchange_rate) ?? "",
    Estado: PAYMENT_STATUS_LABELS[p.status],
    TieneRecibo: (p.receipts?.length ?? 0) > 0 ? "Si" : "No",
  }));

  return (
    <div style={{ display: "grid", gap: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "1.9rem", fontWeight: 700 }}>Rendición de cuentas</h1>
          <p className="muted" style={{ fontSize: "0.88rem", marginTop: "0.25rem" }}>
            Detalle de <strong style={{ color: "var(--text)", textTransform: "capitalize" }}>{monthLabel(mes)}</strong> para presentar al contador.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "end", flexWrap: "wrap" }}>
          <form style={{ display: "flex", gap: "0.5rem", alignItems: "end" }}>
            <div>
              <span className="label">Período</span>
              <input type="month" name="mes" defaultValue={mes} className="input" style={{ width: "auto" }} />
            </div>
            <button type="submit" className="btn btn-ghost">Ver</button>
          </form>
          <ExportCsv rows={csvRows} filename={`rendicion-${mes}.csv`} label="Exportar CSV" />
        </div>
      </div>

      {/* Totales */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1.25rem" }}>
        <Kpi label="Total del período (ARS)" value={formatMoney(totalARS, "ARS")} hint={`${paid.length} pagos confirmados`} />
        <Kpi label="Total en USD" value={formatMoney(totalUSD, "USD")} hint="Pagos en dólares" />
        <Kpi label="Con comprobante" value={`${conComprobante}/${payments.length}`} hint="Tienen tipo de comprobante" />
        <Kpi label="Con recibo adjunto" value={`${conRecibo}/${payments.length}`} hint="Archivo cargado" />
      </div>

      {/* Tabla rendición */}
      {payments.length === 0 ? (
        <div className="card" style={{ padding: "2.5rem", textAlign: "center" }}>
          <p className="muted">No hay pagos registrados en {monthLabel(mes)}.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--glass-border)", textAlign: "left" }}>
                  <Th>Fecha</Th>
                  <Th>Proveedor</Th>
                  <Th>Descripción</Th>
                  <Th>Comprobante</Th>
                  <Th style={{ textAlign: "right" }}>Monto</Th>
                  <Th style={{ textAlign: "right" }}>En ARS</Th>
                  <Th>Estado</Th>
                  <Th style={{ textAlign: "center" }}>Recibo</Th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const ars = toARS(Number(p.amount), p.currency, p.exchange_rate);
                  const hasReceipt = (p.receipts?.length ?? 0) > 0;
                  return (
                    <tr key={p.id} style={{ borderBottom: "1px solid var(--glass-border)" }}>
                      <Td muted>{formatDate(p.payment_date)}</Td>
                      <Td>
                        <div style={{ fontWeight: 500 }}>{p.provider ?? "—"}</div>
                        {p.provider_tax_id && <div style={{ fontSize: "0.72rem", color: "var(--text-faint)" }}>{p.provider_tax_id}</div>}
                      </Td>
                      <Td>
                        {p.description || "—"}
                        {p.category && <div style={{ marginTop: 3 }}><CategoryTag name={p.category.name} color={p.category.color} /></div>}
                      </Td>
                      <Td>
                        <div style={{ fontSize: "0.82rem" }}>{RECEIPT_TYPE_LABELS[p.receipt_type]}</div>
                        {p.receipt_number && <div style={{ fontSize: "0.72rem", color: "var(--text-faint)" }}>{p.receipt_number}</div>}
                      </Td>
                      <Td style={{ textAlign: "right", fontWeight: 600 }}>{formatMoney(p.amount, p.currency)}</Td>
                      <Td muted style={{ textAlign: "right" }}>{formatMoney(ars, "ARS")}</Td>
                      <Td><PaymentStatusBadge status={p.status} /></Td>
                      <Td style={{ textAlign: "center" }}>
                        <span title={hasReceipt ? "Con recibo" : "Sin recibo"} style={{ color: hasReceipt ? "#6ee7b7" : "var(--text-faint)" }}>
                          {hasReceipt ? "✓" : "—"}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <Td colSpan={4} style={{ fontWeight: 600, paddingTop: "0.9rem" }}>Total equivalente en ARS (pagados)</Td>
                  <Td colSpan={4} style={{ textAlign: "left", fontWeight: 700, fontSize: "1rem", paddingTop: "0.9rem" }}>{formatMoney(totalARS, "ARS")}</Td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <p className="muted" style={{ fontSize: "0.8rem" }}>
        Consejo: adjuntá el comprobante en cada pago (imagen o PDF) y completá tipo y número.
        Así el CSV + los archivos son todo lo que el contador necesita para la rendición.
      </p>
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

function Th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th style={{ padding: "0.7rem 0.85rem", fontSize: "0.72rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.03em", ...style }}>
      {children}
    </th>
  );
}
function Td({ children, muted, style, colSpan }: { children?: React.ReactNode; muted?: boolean; style?: React.CSSProperties; colSpan?: number }) {
  return (
    <td colSpan={colSpan} style={{ padding: "0.7rem 0.85rem", fontSize: "0.86rem", color: muted ? "var(--text-muted)" : "var(--text)", verticalAlign: "top", ...style }}>
      {children}
    </td>
  );
}
