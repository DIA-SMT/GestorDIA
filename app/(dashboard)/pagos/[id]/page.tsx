import Link from "next/link";
import { notFound } from "next/navigation";
import { getPayment, listServicesSimple, listCategories, getReceiptUrl } from "@/lib/data";
import PaymentForm from "@/components/payment-form";
import { updatePayment, deletePayment, deleteReceipt } from "../actions";

export default async function PagoDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [p, services, categories] = await Promise.all([
    getPayment(id),
    listServicesSimple(),
    listCategories(),
  ]);

  if (!p) notFound();

  // URLs firmadas para ver los recibos (válidas 10 min)
  const receiptsWithUrl = await Promise.all(
    (p.receipts ?? []).map(async (r) => ({ ...r, url: await getReceiptUrl(r.file_path) }))
  );

  const boundUpdate = updatePayment.bind(null, id);
  const boundDelete = deletePayment.bind(null, id);

  return (
    <div style={{ display: "grid", gap: "2rem", maxWidth: 900 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <Link href="/pagos" style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>← Pagos</Link>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: "0.4rem" }}>
            {p.description || "Pago"}
          </h1>
        </div>
        <form action={boundDelete}>
          <button type="submit" className="btn btn-ghost" style={{ color: "#f87171", borderColor: "#f8717155" }}>
            Eliminar pago
          </button>
        </form>
      </div>

      {/* Recibos */}
      <section className="card" style={{ padding: "1.25rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
          Recibos ({receiptsWithUrl.length})
        </h2>
        {receiptsWithUrl.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.88rem" }}>
            Sin recibos. Podés adjuntar uno desde el formulario de abajo.
          </p>
        ) : (
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {receiptsWithUrl.map((r) => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", padding: "0.6rem 0.8rem", background: "rgba(255,255,255,0.045)", borderRadius: "0.5rem" }}>
                <a href={r.url ?? "#"} target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)", fontSize: "0.88rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  📄 {r.file_name}
                </a>
                <form action={deleteReceipt.bind(null, r.id, id)}>
                  <button type="submit" className="btn btn-ghost" style={{ padding: "0.25rem 0.55rem", fontSize: "0.78rem", color: "#f87171" }}>
                    Quitar
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Editar */}
      <section className="card" style={{ padding: "2rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>Editar pago</h2>
        <PaymentForm
          action={boundUpdate}
          services={services}
          categories={categories}
          payment={p}
          submitLabel="Guardar cambios"
        />
      </section>
    </div>
  );
}
