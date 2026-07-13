import Link from "next/link";
import { listCategories } from "@/lib/data";
import ServiceForm from "@/components/service-form";
import { createService } from "../actions";

export default async function NuevoServicioPage() {
  const categories = await listCategories();

  return (
    <div style={{ display: "grid", gap: "2rem", maxWidth: 900 }}>
      <div>
        <Link href="/servicios" style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>← Servicios</Link>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: "0.4rem" }}>Nuevo servicio</h1>
      </div>
      <div className="card" style={{ padding: "2rem" }}>
        <ServiceForm action={createService} categories={categories} />
      </div>
    </div>
  );
}
