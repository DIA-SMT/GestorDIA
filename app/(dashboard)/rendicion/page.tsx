import { listPaymentsBetween, listCategories } from "@/lib/data";
import { formatMoney, toARS } from "@/lib/utils";
import RendicionTable from "@/components/rendicion-table";
import type { Payment } from "@/lib/types";

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

  const [payments, categories] = await Promise.all([
    listPaymentsBetween(start, end),
    listCategories(),
  ]);
  const rows = payments as (Payment & { receipts?: { id: string }[] })[];

  const paid = rows.filter((p) => p.status === "paid");
  const totalARS = paid.reduce((a, p) => a + (toARS(Number(p.amount), p.currency, p.exchange_rate) ?? 0), 0);
  const totalUSD = paid.filter((p) => p.currency === "USD").reduce((a, p) => a + Number(p.amount), 0);
  const pendientes = rows.filter((p) => !p.rendido_at).length;
  const conRecibo = rows.filter((p) => (p.receipts?.length ?? 0) > 0).length;

  return (
    <div style={{ display: "grid", gap: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "1.9rem", fontWeight: 700 }}>Rendición de cuentas</h1>
          <p className="muted" style={{ fontSize: "0.88rem", marginTop: "0.25rem" }}>
            Detalle de <strong style={{ color: "var(--text)", textTransform: "capitalize" }}>{monthLabel(mes)}</strong> para presentar al contador.
          </p>
        </div>
        <form style={{ display: "flex", gap: "0.5rem", alignItems: "end" }}>
          <div>
            <span className="label">Período</span>
            <input type="month" name="mes" defaultValue={mes} className="input" style={{ width: "auto" }} />
          </div>
          <button type="submit" className="btn btn-ghost">Ver</button>
        </form>
      </div>

      {/* Totales */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1.25rem" }}>
        <Kpi label="Total del período (ARS)" value={formatMoney(totalARS, "ARS")} hint={`${paid.length} pagos confirmados`} />
        <Kpi label="Total en USD" value={formatMoney(totalUSD, "USD")} hint="Pagos en dólares" />
        <Kpi label="Pendientes de rendir" value={`${pendientes}/${rows.length}`} hint="Todavía no presentados" />
        <Kpi label="Con recibo adjunto" value={`${conRecibo}/${rows.length}`} hint="Archivo cargado" />
      </div>

      <RendicionTable payments={rows} categories={categories} mes={mes} mesLabel={monthLabel(mes)} />

      <p className="muted" style={{ fontSize: "0.8rem" }}>
        Consejo: filtrá o seleccioná los pagos que te pida el contador, exportalos en CSV o PDF
        y marcalos como rendidos para llevar el control de lo ya presentado.
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
