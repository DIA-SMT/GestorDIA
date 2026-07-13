"use client";

import { useActionState, useEffect, useRef } from "react";
import { createCategory } from "./actions";

export default function AddCategory() {
  const [state, formAction, pending] = useActionState(createCategory, {});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) ref.current?.reset();
  }, [state]);

  return (
    <form
      ref={ref}
      action={formAction}
      className="card"
      style={{ padding: "1rem", display: "flex", gap: "0.75rem", alignItems: "end", flexWrap: "wrap" }}
    >
      <div style={{ flex: "1 1 200px" }}>
        <span className="label">Nombre</span>
        <input name="name" className="input" placeholder="Ej: Marketing" required />
      </div>
      <div>
        <span className="label">Color</span>
        <input name="color" type="color" defaultValue="#6366f1" style={{ width: 48, height: 40, border: "1px solid var(--glass-border)", borderRadius: 8, background: "rgba(255,255,255,0.045)" }} />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "…" : "Agregar"}
      </button>
      {state?.error && <p style={{ color: "#f87171", fontSize: "0.85rem", flexBasis: "100%" }}>{state.error}</p>}
    </form>
  );
}
