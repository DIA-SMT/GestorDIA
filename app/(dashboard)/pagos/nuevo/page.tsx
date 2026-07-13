import Link from "next/link";
import { listServicesSimple, listCategories } from "@/lib/data";
import PaymentForm from "@/components/payment-form";
import { createPayment } from "../actions";

export default async function NuevoPagoPage() {
  const [services, categories] = await Promise.all([
    listServicesSimple(),
    listCategories(),
  ]);

  return (
    <div style={{ display: "grid", gap: "2rem", maxWidth: 900 }}>
      <div>
        <Link href="/pagos" style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
          ← Pagos
        </Link>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: "0.4rem" }}>
          Registrar pago
        </h1>
      </div>
      <div className="card" style={{ padding: "2rem" }}>
        <PaymentForm action={createPayment} services={services} categories={categories} />
      </div>
    </div>
  );
}
