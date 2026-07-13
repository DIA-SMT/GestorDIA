"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { BillingCycle, Category, Service } from "@/lib/types";

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
  const [cycle, setCycle] = useState<BillingCycle>(service?.billing_cycle ?? "monthly");
  // Recarga a demanda (créditos tipo OpenRouter): sin fecha de cobro ni alertas
  const isOnDemand = cycle === "on_demand";

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

      <div style={grid3}>
        <Field label="¿Cómo se factura?">
          <select
            name="billing_cycle"
            className="select"
            value={cycle}
            onChange={(e) => setCycle(e.target.value as BillingCycle)}
          >
            <option value="monthly">Mensual</option>
            <option value="yearly">Anual</option>
            <option value="quarterly">Trimestral</option>
            <option value="weekly">Semanal</option>
            <option value="on_demand">Recarga a demanda (créditos)</option>
            <option value="one_time">Único</option>
            <option value="custom">Personalizado</option>
          </select>
        </Field>
        <Field label={isOnDemand ? "Monto habitual de recarga (opcional)" : "Monto esperado"}>
          <input name="expected_amount" className="input" inputMode="decimal" placeholder="0.00" defaultValue={service?.expected_amount ?? ""} />
        </Field>
        <Field label="Moneda">
          <select name="currency" className="select" defaultValue={service?.currency ?? "USD"}>
            <option value="USD">USD</option>
            <option value="ARS">ARS</option>
            <option value="EUR">EUR</option>
          </select>
        </Field>
      </div>

      {isOnDemand ? (
        <>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", borderRadius: 10, padding: "0.7rem 0.9rem", margin: 0 }}>
            💡 Recarga a demanda: sin fecha de cobro ni alertas. Cada vez que carguen créditos,
            registran un pago vinculado a este servicio y acá se acumula el historial y el total gastado.
          </p>
          <div style={grid2}>
            <Field label="Estado">
              <select name="status" className="select" defaultValue={service?.status ?? "active"}>
                <option value="active">Activa</option>
                <option value="paused">En pausa</option>
                <option value="cancelled">Cancelada</option>
              </select>
            </Field>
          </div>
        </>
      ) : (
        <>
          <div style={grid2}>
            <Field label="Próxima fecha de cobro">
              <input name="next_renewal_date" type="date" className="input" defaultValue={service?.next_renewal_date ?? ""} />
            </Field>
            <Field label="Estado">
              <select name="status" className="select" defaultValue={service?.status ?? "active"}>
                <option value="active">Activa</option>
                <option value="paused">En pausa</option>
                <option value="cancelled">Cancelada</option>
              </select>
            </Field>
          </div>

          <Field label="¿Cómo se cobra?">
            <select name="payment_mode" className="select" defaultValue={service?.payment_mode ?? "automatic"}>
              <option value="automatic">Débito automático — se cobra solo de la tarjeta</option>
              <option value="manual">Pago manual — necesito una alerta para acordarme de pagarlo</option>
            </select>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              Los de pago manual aparecen destacados en el dashboard cuando se acerca la fecha.
            </span>
          </Field>
        </>
      )}

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
const grid3: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}
