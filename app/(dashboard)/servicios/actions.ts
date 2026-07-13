"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getCurrentUser,
  createService as dataCreateService,
  updateService as dataUpdateService,
  deleteService as dataDeleteService,
  type ServiceInput,
} from "@/lib/data";
import type { BillingCycle, CurrencyCode, ServiceStatus, PaymentMode } from "@/lib/types";

function num(v: FormDataEntryValue | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function str(v: FormDataEntryValue | null): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

function parseInput(formData: FormData): ServiceInput {
  const billing_cycle = (str(formData.get("billing_cycle")) ?? "monthly") as BillingCycle;
  const isOnDemand = billing_cycle === "on_demand";
  return {
    name: str(formData.get("name")) ?? "Servicio",
    description: str(formData.get("description")),
    url: str(formData.get("url")),
    category_id: str(formData.get("category_id")),
    billing_cycle,
    expected_amount: num(formData.get("expected_amount")),
    currency: (str(formData.get("currency")) ?? "USD") as CurrencyCode,
    status: (str(formData.get("status")) ?? "active") as ServiceStatus,
    payment_mode: (str(formData.get("payment_mode")) ?? "automatic") as PaymentMode,
    // A demanda: nunca hay fecha de cobro (y por lo tanto, no genera alertas)
    next_renewal_date: isOnDemand ? null : str(formData.get("next_renewal_date")),
  };
}

export async function createService(_prev: unknown, formData: FormData) {
  if (!str(formData.get("name"))) return { error: "El nombre es obligatorio." };

  const user = await getCurrentUser();
  const res = await dataCreateService(parseInput(formData), user?.id ?? null);
  if (res.error || !res.id) return { error: res.error ?? "No se pudo crear el servicio." };

  revalidatePath("/servicios");
  revalidatePath("/");
  redirect(`/servicios/${res.id}`);
}

export async function updateService(serviceId: string, _prev: unknown, formData: FormData) {
  if (!str(formData.get("name"))) return { error: "El nombre es obligatorio." };

  const res = await dataUpdateService(serviceId, parseInput(formData));
  if (res.error) return { error: res.error };

  revalidatePath(`/servicios/${serviceId}`);
  revalidatePath("/servicios");
  revalidatePath("/");
  return { success: "Servicio actualizado." };
}

export async function deleteService(serviceId: string) {
  await dataDeleteService(serviceId);
  revalidatePath("/servicios");
  revalidatePath("/");
  redirect("/servicios");
}
