"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { Category, Payment, Service } from "@/lib/types";
import { RECEIPT_TYPE_LABELS } from "@/lib/types";
import { formatMoney } from "@/lib/utils";

type FormState = { error?: string; success?: string };

type Action = (prev: unknown, formData: FormData) => Promise<FormState>;

export default function PaymentForm({
  action,
  services,
  categories,
  payment,
  submitLabel = "Guardar pago",
}: {
  action: Action;
  services: Service[];
  categories: Category[];
  payment?: Payment;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  const [currency, setCurrency] = useState(payment?.currency ?? "USD");
  const [amount, setAmount] = useState(payment ? String(payment.amount) : "");
  const [rate, setRate] = useState(
    payment?.exchange_rate ? String(payment.exchange_rate) : ""
  );
  const [fetchingRate, setFetchingRate] = useState(false);

  const showRate = currency !== "ARS";
  const amountNum = Number(String(amount).replace(",", "."));
  const rateNum = Number(String(rate).replace(",", "."));
  const arsPreview =
    currency === "ARS"
      ? amountNum
      : Number.isFinite(amountNum) && Number.isFinite(rateNum) && rateNum > 0
      ? amountNum * rateNum
      : null;

  async function traerDolarTarjeta() {
    setFetchingRate(true);
    try {
      // Dólar tarjeta: la cotización relevante para pagos con tarjeta al exterior
      const res = await fetch("https://dolarapi.com/v1/dolares/tarjeta");
      const data = await res.json();
      if (data?.venta) setRate(String(data.venta));
    } catch {
      // silencioso: si falla, se carga a mano
    } finally {
      setFetchingRate(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} style={{ display: "grid", gap: "1.1rem" }}>
      <div style={grid2}>
        <Field label="Descripción">
          <input
            name="description"
            className="input"
            placeholder="Ej: Cursor Pro — Julio 2026"
            defaultValue={payment?.description ?? ""}
          />
        </Field>
        <Field label="Servicio (opcional)">
          <select name="service_id" className="select" defaultValue={payment?.service_id ?? ""}>
            <option value="">— Pago suelto —</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div style={grid3}>
        <Field label="Monto *">
          <input
            name="amount"
            className="input"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Field>
        <Field label="Moneda">
          <select
            name="currency"
            className="select"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as typeof currency)}
          >
            <option value="USD">USD</option>
            <option value="ARS">ARS</option>
            <option value="EUR">EUR</option>
          </select>
        </Field>
        <Field label="Categoría">
          <select name="category_id" className="select" defaultValue={payment?.category_id ?? ""}>
            <option value="">— Sin categoría —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {showRate && (
        <div className="card" style={{ padding: "0.9rem", background: "rgba(255,255,255,0.045)" }}>
          <div style={grid2}>
            <Field label={`Cotización a ARS (1 ${currency} = ?)`}>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  name="exchange_rate"
                  className="input"
                  inputMode="decimal"
                  placeholder="Ej: 1350.50"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
                {currency === "USD" && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={traerDolarTarjeta}
                    disabled={fetchingRate}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {fetchingRate ? "…" : "Dólar tarjeta"}
                  </button>
                )}
              </div>
            </Field>
            <div style={{ alignSelf: "end" }}>
              <span className="label">Equivalente en pesos</span>
              <div style={{ fontSize: "1.15rem", fontWeight: 700, padding: "0.4rem 0" }}>
                {arsPreview != null ? formatMoney(arsPreview, "ARS") : "—"}
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={grid3}>
        <Field label="Fecha de pago">
          <input
            name="payment_date"
            type="date"
            className="input"
            defaultValue={payment?.payment_date ?? today}
          />
        </Field>
        <Field label="Estado">
          <select name="status" className="select" defaultValue={payment?.status ?? "paid"}>
            <option value="paid">Pagado</option>
            <option value="pending">Pendiente</option>
            <option value="failed">Fallido</option>
            <option value="refunded">Reembolsado</option>
          </select>
        </Field>
        <Field label="Medio de pago">
          <input
            name="payment_method"
            className="input"
            placeholder="Tarjeta principal"
            defaultValue={payment?.payment_method ?? "Tarjeta principal"}
          />
        </Field>
      </div>

      <Field label="Link de donde se pagó / factura">
        <input
          name="payment_url"
          type="url"
          className="input"
          placeholder="https://…"
          defaultValue={payment?.payment_url ?? ""}
        />
      </Field>

      {/* Comprobante / rendición de cuentas */}
      <div className="card" style={{ padding: "1rem", background: "rgba(255,255,255,0.02)" }}>
        <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: "0.9rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          🧾 Comprobante <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>· para la rendición al contador</span>
        </div>
        <div style={{ display: "grid", gap: "1rem" }}>
          <div style={grid2}>
            <Field label="Proveedor / razón social">
              <input name="provider" className="input" placeholder="Ej: Anysphere Inc." defaultValue={payment?.provider ?? ""} />
            </Field>
            <Field label="CUIT / ID fiscal (si tiene)">
              <input name="provider_tax_id" className="input" placeholder="Ej: 30-71234567-9" defaultValue={payment?.provider_tax_id ?? ""} />
            </Field>
          </div>
          <div style={grid2}>
            <Field label="Tipo de comprobante">
              <select name="receipt_type" className="select" defaultValue={payment?.receipt_type ?? "sin_comprobante"}>
                {(Object.keys(RECEIPT_TYPE_LABELS) as (keyof typeof RECEIPT_TYPE_LABELS)[]).map((k) => (
                  <option key={k} value={k}>{RECEIPT_TYPE_LABELS[k]}</option>
                ))}
              </select>
            </Field>
            <Field label="N° de comprobante / factura">
              <input name="receipt_number" className="input" placeholder="Ej: 0001-00012345" defaultValue={payment?.receipt_number ?? ""} />
            </Field>
          </div>
        </div>
      </div>

      <Field label="Notas">
        <textarea name="notes" className="textarea" rows={2} defaultValue={payment?.notes ?? ""} />
      </Field>

      <Field label="Adjuntar recibo(s)">
        <input
          name="receipts"
          type="file"
          multiple
          className="input"
          accept="image/*,application/pdf"
          style={{ padding: "0.4rem" }}
        />
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          Podés subir imágenes o PDF. Se guardan de forma privada en Supabase Storage.
        </span>
      </Field>

      {state?.error && <p style={{ color: "#f87171", fontSize: "0.9rem" }}>{state.error}</p>}
      {state?.success && <p style={{ color: "#34d399", fontSize: "0.9rem" }}>{state.success}</p>}

      <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.25rem" }}>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Guardando…" : submitLabel}
        </button>
        <Link href="/pagos" className="btn btn-ghost">
          Cancelar
        </Link>
      </div>
    </form>
  );
}

const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "1rem",
};
const grid3: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: "1rem",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}
