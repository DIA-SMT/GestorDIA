// Armado de la rendición: lo que todavía no se le entregó al contador.
//
// La pantalla ya no se organiza por mes calendario. El eje es "lo pendiente",
// venga del período que venga: los gastos se anotan cuando se pagan y las
// facturas llegan semanas después, así que un mes cerrado no significa nada.
// Lo ya entregado vive en /rendicion/historial, como lotes cerrados.

import Link from "next/link";
import {
  listPendientesDeRendir,
  listCategories,
  listRendiciones,
  hasRendicionesTable,
} from "@/lib/data";
import { formatMoney, toARS, todayISO, formatDate, toLocalDay } from "@/lib/utils";
import { resumirPreparacion } from "@/lib/rendicion-status";
import RendicionArmar from "@/components/rendicion-armar";
import type { Payment } from "@/lib/types";

export default async function RendicionPage() {
  const [pendientes, categories, rendiciones, migrado] = await Promise.all([
    listPendientesDeRendir(),
    listCategories(),
    listRendiciones(),
    hasRendicionesTable(),
  ]);

  const rows = pendientes as (Payment & { receipts?: { id: string }[] })[];
  const rendibles = rows.filter((p) => p.status === "paid");

  const totalARS = rendibles.reduce((a, p) => a + (toARS(Number(p.amount), p.currency, p.exchange_rate) ?? 0), 0);
  const totalUSD = rendibles.filter((p) => p.currency === "USD").reduce((a, p) => a + Number(p.amount), 0);
  const prep = resumirPreparacion(rendibles);

  // Lo más viejo sin rendir: si hay algo de hace meses, es lo que hay que mirar
  const masViejo = rendibles.reduce<string | null>(
    (min, p) => (min === null || p.payment_date < min ? p.payment_date : min),
    null
  );
  const mesActual = todayISO().slice(0, 7);
  const arrastres = rendibles.filter((p) => p.payment_date.slice(0, 7) < mesActual).length;

  const ultima = rendiciones[0];

  return (
    <div style={{ display: "grid", gap: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "1.9rem", fontWeight: 700 }}>Rendición de cuentas</h1>
          <p className="muted" style={{ fontSize: "0.88rem", marginTop: "0.25rem" }}>
            Elegí qué gastos le entregás al contador y generá el comprobante. Todo lo pendiente está acá, sin importar
            de qué mes sea.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {ultima && (
            <span className="muted" style={{ fontSize: "0.78rem" }}>
              Última: N° {ultima.numero} · {formatDate(toLocalDay(ultima.presentada_at))}
            </span>
          )}
          <Link href="/rendicion/historial" className="btn btn-ghost">
            📁 Historial ({rendiciones.length})
          </Link>
        </div>
      </div>

      {/* Totales de lo que falta rendir */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(196px, 1fr))", gap: "1rem" }}>
        <Kpi
          label="Pendiente de rendir (ARS)"
          value={formatMoney(totalARS, "ARS")}
          hint={`${rendibles.length} ${rendibles.length === 1 ? "pago confirmado" : "pagos confirmados"}`}
        />
        <Kpi label="Pendiente en USD" value={formatMoney(totalUSD, "USD")} hint="Pagos en dólares" />
        <Kpi
          label="Listos para rendir"
          value={`${prep.listos}/${prep.total}`}
          hint={prep.sinDatos > 0 ? `${prep.sinDatos} sin factura cargada` : "Con todos los datos fiscales"}
          alerta={prep.sinDatos > 0}
        />
        <Kpi
          label="Arrastres"
          value={String(arrastres)}
          hint={
            masViejo && arrastres > 0
              ? `De meses anteriores. El más viejo: ${formatDate(masViejo)}`
              : "Nada quedó de meses anteriores"
          }
          alerta={arrastres > 0}
        />
      </div>

      <RendicionArmar payments={rows} categories={categories} migrado={migrado} />

      <p className="muted" style={{ fontSize: "0.8rem" }}>
        Circuito: se anota el gasto cuando se paga → cuando el contador manda las facturas se completan los datos con el
        lápiz de cada fila → se seleccionan los pagos y se aprieta{" "}
        <strong style={{ color: "var(--text)" }}>“Rendir y generar comprobante”</strong>. Eso cierra una rendición
        numerada, baja el PDF con las facturas incrustadas y archiva una copia. Todo queda en el{" "}
        <Link href="/rendicion/historial" style={{ color: "var(--text)" }}>historial</Link>.
      </p>
    </div>
  );
}

function Kpi({ label, value, hint, alerta }: { label: string; value: string; hint?: string; alerta?: boolean }) {
  return (
    <div className="card" style={{ padding: "1.5rem" }}>
      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{label}</div>
      <div
        className="font-display"
        style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: "0.3rem", color: alerta ? "#fbbf24" : undefined }}
      >
        {value}
      </div>
      {hint && <div style={{ fontSize: "0.74rem", color: "var(--text-faint)", marginTop: "0.25rem" }}>{hint}</div>}
    </div>
  );
}
