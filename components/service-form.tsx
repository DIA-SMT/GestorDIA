"use client";

// Alta/edición de un servicio. Un servicio es solo un AGRUPADOR de pagos: no
// tiene ciclo de facturación, ni monto esperado, ni fecha de renovación. El
// gasto real cambia todos los meses, así que esos campos proponían siempre el
// número equivocado; ahora cada pago se carga cuando se paga.

import { useActionState } from "react";
import Link from "next/link";
import type { Category, Service } from "@/lib/types";

type FormState = { error?: string; success?: string };
type Action = (prev: unknown, formData: FormData) => Promise<FormState>;

export default function ServiceForm({
  action,
  categories,
  service,
  submitLabel = "Guardar servicio",
}: {
  action: Action;
  categories: Category[];
  service?: Service;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} style={{ display: "grid", gap: "1.1rem" }}>
      <div style={grid2}>
        <Field label="Nombre *">
          <input name="name" className="input" placeholder="Ej: Cursor Pro" defaultValue={service?.name ?? ""} required />
        </Field>
        <Field label="Categoría">
          <select name="category_id" className="select" defaultValue={service?.category_id ?? ""}>
            <option value="">— Sin categoría —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="URL del servicio / panel de la cuenta">
        <input name="url" type="url" className="input" placeholder="https://…" defaultValue={service?.url ?? ""} />
      </Field>

      <div style={grid2}>
        <Field label="Estado">
          <select name="status" className="select" defaultValue={service?.status ?? "active"}>
            <option value="active">Activa</option>
            <option value="paused">En pausa</option>
            <option value="cancelled">Cancelada</option>
          </select>
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Dar de baja no borra nada: el historial de pagos se conserva.
          </span>
        </Field>
      </div>

      <Field label="Descripción / notas">
        <textarea name="description" className="textarea" rows={2} defaultValue={service?.description ?? ""} />
      </Field>

      {state?.error && <p style={{ color: "#f87171", fontSize: "0.9rem" }}>{state.error}</p>}
      {state?.success && <p style={{ color: "#34d399", fontSize: "0.9rem" }}>{state.success}</p>}

      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Guardando…" : submitLabel}
        </button>
        <Link href="/servicios" className="btn btn-ghost">Cancelar</Link>
      </div>
    </form>
  );
}

const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}
