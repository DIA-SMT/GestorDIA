import Link from "next/link";
import { notFound } from "next/navigation";
import { getPayment, listServicesSimple, listCategories, getReceiptUrl } from "@/lib/data";
import PaymentForm from "@/components/payment-form";
import { updatePayment, deletePayment, deleteReceipt } from "../actions";
import { formatMoney, formatDate, toARS } from "@/lib/utils";
import { PaymentStatusBadge, CategoryTag } from "@/components/badges";
import { RECEIPT_TYPE_LABELS } from "@/lib/types";

export default async function PagoDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ editar?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const editMode = sp.editar === "1";

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

  const ars = toARS(Number(p.amount), p.currency, p.exchange_rate);
  const boundUpdate = updatePayment.bind(null, id);
  const boundDelete = deletePayment.bind(null, id);

  // ============ MODO EDICIÓN ============
  if (editMode) {
    return (
      <div style={{ display: "grid", gap: "2rem", maxWidth: 900 }}>
        <div>
          <Link href={`/pagos/${id}`} style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            ← Volver al pago
          </Link>
          <h1 style={{ fontSize: "1.6rem", fontWeight: 700, marginTop: "0.4rem" }}>
            Editar pago
          </h1>
        </div>

        {/* Recibos existentes (con opción de quitar) */}
        {receiptsWithUrl.length > 0 && (
          <section className="card" style={{ padding: "1.5rem" }}>
            <h2 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.75rem" }}>
              Recibos cargados ({receiptsWithUrl.length})
            </h2>
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {receiptsWithUrl.map((r) => (
                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", padding: "0.6rem 0.8rem", background: "rgba(255,255,255,0.03)", borderRadius: "0.5rem" }}>
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
          </section>
        )}

        <section className="card" style={{ padding: "2rem" }}>
          <PaymentForm
            action={boundUpdate}
            services={services}
            categories={categories}
            payment={p}
            submitLabel="Guardar cambios"
            cancelHref={`/pagos/${id}`}
          />
        </section>
      </div>
    );
  }

  // ============ VISTA TICKET ============
  return (
    <div style={{ display: "grid", gap: "1.5rem", maxWidth: 620, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Link href="/pagos" style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
          ← Pagos
        </Link>
        <div style={{ display: "flex", gap: "0.6rem" }}>
          <Link href={`/pagos/${id}?editar=1`} className="btn btn-primary">
            ✏️ Editar
          </Link>
          <form action={boundDelete}>
            <button type="submit" className="btn btn-ghost" style={{ color: "#f87171", borderColor: "#f8717155" }}>
              Eliminar
            </button>
          </form>
        </div>
      </div>

      {/* Ticket */}
      <div className="card" style={{ overflow: "hidden" }}>
        {/* Encabezado */}
        <div style={{ padding: "1.75rem 2rem 1.5rem", borderBottom: "1px dashed rgba(255,255,255,0.14)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "1rem", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: "0.72rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: "0.4rem" }}>
                Comprobante de pago
              </div>
              <h1 className="font-display" style={{ fontSize: "1.35rem", fontWeight: 700, lineHeight: 1.25 }}>
                {p.description || p.service?.name || "Pago"}
              </h1>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem", flexWrap: "wrap" }}>
                {p.category && <CategoryTag name={p.category.name} color={p.category.color} />}
                <PaymentStatusBadge status={p.status} />
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div className="font-display" style={{ fontSize: "2rem", fontWeight: 700, lineHeight: 1 }}>
                {formatMoney(p.amount, p.currency)}
              </div>
              {p.currency !== "ARS" && ars != null && (
                <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
                  ≈ {formatMoney(ars, "ARS")}
                  {p.exchange_rate && (
                    <span style={{ color: "var(--text-faint)" }}> · cotiz. {p.exchange_rate}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Detalle */}
        <div style={{ padding: "1.5rem 2rem", display: "grid", gap: "0.65rem" }}>
          <Row label="Fecha de pago" value={formatDate(p.payment_date)} />
          {p.service && (
            <Row
              label="Servicio"
              value={
                <Link href={`/servicios/${p.service_id}`} style={{ color: "var(--primary)" }}>
                  {p.service.name} →
                </Link>
              }
            />
          )}
          <Row label="Medio de pago" value={p.payment_method || "—"} />
          {p.payment_url && (
            <Row
              label="Pagado en"
              value={
                <a href={p.payment_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)", wordBreak: "break-all" }}>
                  {p.payment_url} ↗
                </a>
              }
            />
          )}
        </div>

        {/* Datos fiscales */}
        <div style={{ padding: "1.5rem 2rem", borderTop: "1px dashed rgba(255,255,255,0.14)", display: "grid", gap: "0.65rem" }}>
          <div style={{ fontSize: "0.72rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: "0.2rem" }}>
            Para rendición
          </div>
          <Row label="Proveedor" value={p.provider || "—"} />
          <Row label="CUIT / ID fiscal" value={p.provider_tax_id || "—"} />
          <Row label="Tipo de comprobante" value={RECEIPT_TYPE_LABELS[p.receipt_type]} />
          <Row label="N° de comprobante" value={p.receipt_number || "—"} />
        </div>

        {/* Recibos adjuntos */}
        <div style={{ padding: "1.5rem 2rem", borderTop: "1px dashed rgba(255,255,255,0.14)" }}>
          <div style={{ fontSize: "0.72rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: "0.75rem" }}>
            Recibos adjuntos ({receiptsWithUrl.length})
          </div>
          {receiptsWithUrl.length === 0 ? (
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: 0 }}>
              Sin recibos. Podés adjuntar desde <Link href={`/pagos/${id}?editar=1`} style={{ color: "var(--primary)" }}>Editar</Link>.
            </p>
          ) : (
            <div style={{ display: "grid", gap: "0.4rem" }}>
              {receiptsWithUrl.map((r) => (
                <a
                  key={r.id}
                  href={r.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--primary)", fontSize: "0.88rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  📄 {r.file_name}
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Notas */}
        {p.notes && (
          <div style={{ padding: "1.5rem 2rem", borderTop: "1px dashed rgba(255,255,255,0.14)" }}>
            <div style={{ fontSize: "0.72rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: "0.5rem" }}>
              Notas
            </div>
            <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", margin: 0, whiteSpace: "pre-wrap" }}>{p.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "1.5rem", fontSize: "0.9rem" }}>
      <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right", fontWeight: 500 }}>{value}</span>
    </div>
  );
}
