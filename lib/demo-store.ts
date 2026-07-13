// Store en memoria para el MODO DEMO (cuando no hay credenciales de Supabase).
// Los datos viven mientras el server esté corriendo. Se guardan en globalThis
// para sobrevivir al hot-reload del dev server.

import type { Category, Payment, Receipt, Service } from "./types";

export interface DemoDB {
  categories: Category[];
  services: Service[];
  payments: Payment[];
  receipts: Receipt[];
}

function seed(): DemoDB {
  const t = "2026-07-13T00:00:00Z";

  const categories: Category[] = [
    { id: "cat-ia", name: "IA / Créditos", color: "#8b5cf6", created_at: t },
    { id: "cat-host", name: "Hosting / Deploy", color: "#06b6d4", created_at: t },
    { id: "cat-dom", name: "Dominios", color: "#f59e0b", created_at: t },
    { id: "cat-design", name: "Diseño", color: "#ec4899", created_at: t },
    { id: "cat-tools", name: "Herramientas", color: "#10b981", created_at: t },
    { id: "cat-otros", name: "Otros", color: "#6b7280", created_at: t },
  ];

  const services: Service[] = [
    {
      id: "srv-cursor", name: "Cursor Pro", description: "IDE con IA",
      url: "https://cursor.com/settings", category_id: "cat-ia",
      billing_cycle: "monthly", expected_amount: 20, currency: "USD",
      status: "active", payment_mode: "automatic", next_renewal_date: "2026-07-18",
      created_by: null, created_at: t, updated_at: t,
    },
    {
      id: "srv-openai", name: "OpenAI API", description: "Créditos de API",
      url: "https://platform.openai.com/account/billing", category_id: "cat-ia",
      billing_cycle: "monthly", expected_amount: 30, currency: "USD",
      status: "active", payment_mode: "manual", next_renewal_date: "2026-07-14",
      created_by: null, created_at: t, updated_at: t,
    },
    {
      id: "srv-vercel", name: "Vercel Pro", description: "Hosting / deploy",
      url: "https://vercel.com/dashboard", category_id: "cat-host",
      billing_cycle: "monthly", expected_amount: 20, currency: "USD",
      status: "active", payment_mode: "automatic", next_renewal_date: "2026-07-25",
      created_by: null, created_at: t, updated_at: t,
    },
    {
      id: "srv-dominio", name: "Dominio gestordia.com", description: "Renovación anual",
      url: null, category_id: "cat-dom",
      billing_cycle: "yearly", expected_amount: 15, currency: "USD",
      status: "active", payment_mode: "manual", next_renewal_date: "2027-01-10",
      created_by: null, created_at: t, updated_at: t,
    },
    {
      id: "srv-figma", name: "Figma", description: "Diseño (dado de baja)",
      url: "https://figma.com", category_id: "cat-design",
      billing_cycle: "monthly", expected_amount: 12, currency: "USD",
      status: "cancelled", payment_mode: "automatic", next_renewal_date: null,
      created_by: null, created_at: t, updated_at: t,
    },
  ];

  const base = {
    payment_method: "Tarjeta principal" as string | null,
    paid_by: null,
    created_at: t,
    updated_at: t,
  };

  const payments: Payment[] = [
    {
      id: "pay-1", service_id: "srv-cursor", category_id: "cat-ia",
      description: "Cursor Pro — Julio 2026", amount: 20, currency: "USD",
      exchange_rate: 1350, amount_ars: 27000, payment_date: "2026-07-05",
      payment_url: "https://cursor.com/settings", status: "paid",
      provider: "Anysphere Inc.", provider_tax_id: null,
      receipt_type: "comprobante_exterior", receipt_number: "INV-20260705",
      notes: null, ...base,
    },
    {
      id: "pay-2", service_id: "srv-vercel", category_id: "cat-host",
      description: "Vercel Pro — Julio 2026", amount: 20, currency: "USD",
      exchange_rate: 1360, amount_ars: 27200, payment_date: "2026-07-02",
      payment_url: "https://vercel.com/dashboard", status: "paid",
      provider: "Vercel Inc.", provider_tax_id: null,
      receipt_type: "comprobante_exterior", receipt_number: "INV-88213",
      notes: null, ...base,
    },
    {
      id: "pay-3", service_id: "srv-openai", category_id: "cat-ia",
      description: "OpenAI API — recarga", amount: 25, currency: "USD",
      exchange_rate: 1355, amount_ars: 33875, payment_date: "2026-07-10",
      payment_url: null, status: "paid",
      provider: "OpenAI LLC", provider_tax_id: null,
      receipt_type: "comprobante_exterior", receipt_number: "OA-4471",
      notes: "Recarga de créditos", ...base,
    },
    {
      id: "pay-4", service_id: null, category_id: "cat-host",
      description: "Servidor VPS extra", amount: 8000, currency: "ARS",
      exchange_rate: null, amount_ars: 8000, payment_date: "2026-07-08",
      payment_url: null, status: "paid",
      provider: "Hosting Local S.A.", provider_tax_id: "30-71234567-9",
      receipt_type: "factura_b", receipt_number: "0001-00012345",
      notes: null, ...base,
    },
    {
      id: "pay-5", service_id: "srv-dominio", category_id: "cat-dom",
      description: "Renovación dominio", amount: 15, currency: "USD",
      exchange_rate: 1340, amount_ars: 20100, payment_date: "2026-06-20",
      payment_url: null, status: "paid",
      provider: "NIC Argentina", provider_tax_id: "30-70000000-0",
      receipt_type: "factura_b", receipt_number: "0003-00004567",
      notes: null, ...base,
    },
    {
      id: "pay-6", service_id: null, category_id: "cat-tools",
      description: "Notion (pendiente de confirmar)", amount: 10, currency: "USD",
      exchange_rate: 1355, amount_ars: 13550, payment_date: "2026-07-12",
      payment_url: null, status: "pending",
      provider: "Notion Labs Inc.", provider_tax_id: null,
      receipt_type: "sin_comprobante", receipt_number: null,
      notes: null, ...base,
    },
  ];

  return { categories, services, payments, receipts: [] };
}

export function demoDb(): DemoDB {
  const g = globalThis as unknown as { __gestorDemoDB?: DemoDB };
  if (!g.__gestorDemoDB) g.__gestorDemoDB = seed();
  return g.__gestorDemoDB;
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
