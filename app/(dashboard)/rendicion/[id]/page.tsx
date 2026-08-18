import { notFound } from "next/navigation";
import Link from "next/link";
import { getRendicion, IS_DEMO } from "@/lib/data";
import { formatMoney, formatDate, toLocalDay } from "@/lib/utils";
import { rangoLegible, tituloDe } from "@/lib/rendicion-doc";
import RendicionDetalle from "@/components/rendicion-detalle";

export default async function RendicionDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rendicion = await getRendicion(id);
  if (!rendicion) notFound();

  const { payments, ...cabecera } = rendicion;

  return (
    <div style={{ display: "grid", gap: "2rem" }}>
      <div>
        <Link href="/rendicion/historial" className="muted" style={{ fontSize: "0.82rem" }}>
          ← Todas las rendiciones
        </Link>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", flexWrap: "wrap", gap: "1rem", marginTop: "0.5rem" }}>
          <div>
            <h1 style={{ fontSize: "1.9rem", fontWeight: 700 }}>{tituloDe(cabecera)}</h1>
            <p className="muted" style={{ fontSize: "0.88rem", marginTop: "0.25rem" }}>
              Presentada el <strong style={{ color: "var(--text)" }}>{formatDate(toLocalDay(cabecera.presentada_at))}</strong>{" "}
              · gastos del {rangoLegible(cabecera.periodo_desde, cabecera.periodo_hasta)}
            </p>
            {cabecera.notas && (
              <p style={{ fontSize: "0.83rem", color: "var(--text-faint)", marginTop: "0.35rem" }}>{cabecera.notas}</p>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(196px, 1fr))", gap: "1rem" }}>
        <Kpi label="Total rendido (ARS)" value={formatMoney(Number(cabecera.total_ars), "ARS")} hint="Congelado al presentarla" />
        <Kpi label="Total en USD" value={formatMoney(Number(cabecera.total_usd), "USD")} hint="Pagos en dólares" />
        <Kpi label="Pagos incluidos" value={String(cabecera.cantidad)} hint="Comprobantes de la entrega" />
        <Kpi label="N° de rendición" value={String(cabecera.numero)} hint="Correlativo del sistema" />
      </div>

      <RendicionDetalle rendicion={cabecera} payments={payments} demo={IS_DEMO} />
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
