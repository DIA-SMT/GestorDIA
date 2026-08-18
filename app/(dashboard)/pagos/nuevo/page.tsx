import Link from "next/link";
import { listServicesSimple, listCategories, getPayment } from "@/lib/data";
import PaymentForm from "@/components/payment-form";
import { formatDate, formatMoney, todayISO, correrPeriodoEnDescripcion } from "@/lib/utils";
import { createPayment } from "../actions";
import type { Payment } from "@/lib/types";

export default async function NuevoPagoPage({
  searchParams,
}: {
  searchParams: Promise<{ repetir?: string }>;
}) {
  const { repetir } = await searchParams;

  const [services, categories, original] = await Promise.all([
    listServicesSimple(),
    listCategories(),
    repetir ? getPayment(repetir) : Promise.resolve(null),
  ]);

  // Repetir un gasto: se precarga todo lo que se mantiene mes a mes y se
  // limpia lo que no. La fecha va en hoy y el N° de comprobante vacío porque
  // cambia en cada factura; dejarlo pegado del mes anterior sería peor que no
  // ponerlo, porque se rinde un número que no corresponde. El monto SÍ se
  // precarga aunque suela cambiar: es más rápido corregirlo que tipearlo.
  const hoy = todayISO();
  const plantilla: Payment | undefined = original
    ? {
        ...original,
        // "Cursor Pro — Julio 2026" repetido en agosto tiene que decir agosto:
        // si no, se termina rindiendo un pago que dice el mes equivocado.
        description: correrPeriodoEnDescripcion(original.description, original.payment_date, hoy),
        payment_date: hoy,
        receipt_number: null,
        status: "paid",
        notes: null,
        rendido_at: null,
        rendicion_id: null,
        receipts: [],
      }
    : undefined;

  return (
    <div style={{ display: "grid", gap: "2rem", maxWidth: 900 }}>
      <div>
        <Link href="/pagos" style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
          ← Pagos
        </Link>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: "0.4rem" }}>
          {original ? "Repetir gasto" : "Registrar pago"}
        </h1>
      </div>

      {original && (
        <div
          className="card"
          style={{
            padding: "0.9rem 1.1rem",
            borderColor: "rgba(47,169,255,.35)",
            background: "rgba(47,169,255,.05)",
            fontSize: "0.85rem",
            display: "grid",
            gap: "0.3rem",
          }}
        >
          <span>
            ↻ Copiado de{" "}
            <Link href={`/pagos/${original.id}`} style={{ color: "var(--text)", fontWeight: 600 }}>
              {original.description || original.service?.name || original.provider || "un pago"}
            </Link>{" "}
            del {formatDate(original.payment_date)} · {formatMoney(original.amount, original.currency)}
          </span>
          <span className="muted" style={{ fontSize: "0.78rem" }}>
            La fecha quedó en hoy y el N° de comprobante en blanco. Revisá el monto: casi siempre cambia.
          </span>
        </div>
      )}

      <div className="card" style={{ padding: "2rem" }}>
        <PaymentForm
          action={createPayment}
          services={services}
          categories={categories}
          payment={plantilla}
          submitLabel={original ? "Registrar este mes" : "Guardar pago"}
        />
      </div>
    </div>
  );
}
