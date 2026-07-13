import { listCategories, categoryPaymentCounts } from "@/lib/data";
import AddCategory from "./add-category";
import { updateCategory, deleteCategory } from "./actions";

export default async function CategoriasPage() {
  const [categories, counts] = await Promise.all([
    listCategories(),
    categoryPaymentCounts(),
  ]);

  return (
    <div style={{ display: "grid", gap: "2rem", maxWidth: 900 }}>
      <div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>Categorías</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: "0.2rem" }}>
          Sirven para discriminar los pagos (IA, hosting, dominios, etc.).
        </p>
      </div>

      <AddCategory />

      <div className="card" style={{ padding: "0.5rem" }}>
        {categories.length === 0 ? (
          <p style={{ padding: "1.5rem", textAlign: "center", color: "var(--text-muted)" }}>No hay categorías.</p>
        ) : (
          categories.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.6rem 0.7rem", borderBottom: "1px solid var(--glass-border)" }}>
              <form action={updateCategory.bind(null, c.id)} style={{ display: "flex", alignItems: "center", gap: "0.6rem", flex: 1 }}>
                <input name="color" type="color" defaultValue={c.color} style={{ width: 34, height: 34, border: "1px solid var(--glass-border)", borderRadius: 6, background: "transparent", flexShrink: 0 }} />
                <input name="name" defaultValue={c.name} className="input" style={{ flex: 1, maxWidth: 260 }} />
                <button type="submit" className="btn btn-ghost" style={{ padding: "0.4rem 0.6rem", fontSize: "0.8rem" }}>Guardar</button>
              </form>
              <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                {counts[c.id] ?? 0} pagos
              </span>
              <form action={deleteCategory.bind(null, c.id)}>
                <button type="submit" className="btn btn-ghost" style={{ padding: "0.4rem 0.6rem", fontSize: "0.8rem", color: "#f87171" }}>
                  Borrar
                </button>
              </form>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
