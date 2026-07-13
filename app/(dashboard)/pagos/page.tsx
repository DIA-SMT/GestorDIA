import Link from "next/link";
import { listPayments, listCategories } from "@/lib/data";
import { formatMoney, formatDate, toARS } from "@/lib/utils";
import { PaymentStatusBadge, CategoryTag } from "@/components/badges";

export default async function PagosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; status?: string; currency?: string }>;
}) {
  const sp = await searchParams;

  const [categories, payments] = await Promise.all([
    listCategories(),
    listPayments({ q: sp.q, category: sp.category, status: sp.status, currency: sp.currency }),
  ]);

  const totalARS = payments
    .filter((p) => p.status === "paid")
    .reduce((acc, p) => acc + (toARS(Number(p.amount), p.currency, p.exchange_rate) ?? 0), 0);

  return (
    <div style={{ display: "grid", gap: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 style={{ fontSize: "1.9rem", fontWeight: 700 }}>Pagos</h1>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: "0.2rem" }}>
            {payments.length} pagos · {formatMoney(totalARS, "ARS")} equivalente pagado
          </p>
        </div>
        <Link href="/pagos/nuevo" className="btn btn-primary">
          + Registrar pago
        </Link>
      </div>

      {/* Filtros */}
      <form className="card" style={{ padding: "1.5rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.75rem", alignItems: "end" }}>
        <div>
          <span className="label">Buscar</span>
          <input name="q" className="input" placeholder="Descripción…" defaultValue={sp.q ?? ""} />
        </div>
        <div>
          <span className="label">Categoría</span>
          <select name="category" className="select" defaultValue={sp.category ?? ""}>
            <option value="">Todas</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <span className="label">Estado</span>
          <select name="status" className="select" defaultValue={sp.status ?? ""}>
            <option value="">Todos</option>
            <option value="paid">Pagado</option>
            <option value="pending">Pendiente</option>
            <option value="failed">Fallido</option>
            <option value="refunded">Reembolsado</option>
          </select>
        </div>
        <div>
          <span className="label">Moneda</span>
          <select name="currency" className="select" defaultValue={sp.currency ?? ""}>
            <option value="">Todas</option>
            <option value="USD">USD</option>
            <option value="ARS">ARS</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }}>Filtrar</button>
          <Link href="/pagos" className="btn btn-ghost">Limpiar</Link>
        </div>
      </form>

      {/* Tabla */}
      {payments.length === 0 ? (
        <div className="card" style={{ padding: "2.5rem", textAlign: "center", color: "var(--text-muted)" }}>
          No hay pagos que coincidan.{" "}
          <Link href="/pagos/nuevo" style={{ color: "var(--primary)" }}>Registrá uno.</Link>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--glass-border)", textAlign: "left" }}>
                  <Th>Fecha</Th>
                  <Th>Descripción</Th>
                  <Th>Categoría</Th>
                  <Th style={{ textAlign: "right" }}>Monto</Th>
                  <Th style={{ textAlign: "right" }}>En ARS</Th>
                  <Th>Estado</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const ars = toARS(Number(p.amount), p.currency, p.exchange_rate);
                  return (
                    <tr key={p.id} style={{ borderBottom: "1px solid var(--glass-border)" }}>
                      <Td muted>{formatDate(p.payment_date)}</Td>
                      <Td>
                        <Link href={`/pagos/${p.id}`} style={{ fontWeight: 500 }}>
                          {p.description || p.service?.name || "Pago"}
                        </Link>
                        {p.receipts && p.receipts.length > 0 && (
                          <span title="Tiene recibo" style={{ marginLeft: 6, fontSize: "0.75rem" }}>📎{p.receipts.length}</span>
                        )}
                      </Td>
                      <Td>{p.category ? <CategoryTag name={p.category.name} color={p.category.color} /> : <span style={{ color: "var(--text-muted)" }}>—</span>}</Td>
                      <Td style={{ textAlign: "right", fontWeight: 600 }}>{formatMoney(p.amount, p.currency)}</Td>
                      <Td muted style={{ textAlign: "right" }}>{formatMoney(ars, "ARS")}</Td>
                      <Td><PaymentStatusBadge status={p.status} /></Td>
                      <Td><Link href={`/pagos/${p.id}`} style={{ color: "var(--primary)", fontSize: "0.85rem" }}>Ver →</Link></Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th style={{ padding: "0.7rem 0.85rem", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.03em", ...style }}>
      {children}
    </th>
  );
}
function Td({ children, muted, style }: { children?: React.ReactNode; muted?: boolean; style?: React.CSSProperties }) {
  return (
    <td style={{ padding: "0.7rem 0.85rem", fontSize: "0.88rem", color: muted ? "var(--text-muted)" : "var(--text)", ...style }}>
      {children}
    </td>
  );
}
