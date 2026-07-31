"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getCurrentUser,
  getService,
  createService as dataCreateService,
  updateService as dataUpdateService,
  deleteService as dataDeleteService,
  setServiceAnchorDay,
  type ServiceInput,
} from "@/lib/data";
import type { BillingCycle, CurrencyCode, ServiceStatus, PaymentMode } from "@/lib/types";

// El día de cobro se guarda aparte de la fecha (ver services.billing_anchor_day
// en la migración 0004): la fecha se recorta en los meses cortos, el día no.
// Va por su propia función y no dentro de ServiceInput, así un spread no
// escribe a ciegas en una columna que puede no existir todavía.
function anchorDayFrom(date: string | null): number | null {
  if (!date) return null;
  const d = Number(date.slice(8, 10));
  return d >= 1 && d <= 31 ? d : null;
}

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
  const input = parseInput(formData);
  const res = await dataCreateService(input, user?.id ?? null);
  if (res.error || !res.id) return { error: res.error ?? "No se pudo crear el servicio." };
  await setServiceAnchorDay(res.id, anchorDayFrom(input.next_renewal_date));

  revalidatePath("/servicios");
  revalidatePath("/");
  redirect(`/servicios/${res.id}`);
}

export async function updateService(serviceId: string, _prev: unknown, formData: FormData) {
  if (!str(formData.get("name"))) return { error: "El nombre es obligatorio." };

  const input = parseInput(formData);

  // El día de cobro SOLO se recalcula si el usuario cambió la fecha a mano.
  // El input del formulario reenvía la fecha guardada tal cual, y esa fecha
  // puede venir recortada por un mes corto (un servicio del 31 queda en 28/02
  // después de confirmar enero). Si se recalculara siempre, guardar cualquier
  // otro campo degradaría el día de cobro a 28 para siempre, que es justo lo
  // que la columna billing_anchor_day existe para evitar.
  const previo = await getService(serviceId);
  const cambioLaFecha = previo?.next_renewal_date !== input.next_renewal_date;

  const res = await dataUpdateService(serviceId, input);
  if (res.error) return { error: res.error };
  if (cambioLaFecha) await setServiceAnchorDay(serviceId, anchorDayFrom(input.next_renewal_date));

  revalidatePath(`/servicios/${serviceId}`);
  revalidatePath("/servicios");
  revalidatePath("/");
  revalidatePath("/rendicion");
  return { success: "Servicio actualizado." };
}

export async function deleteService(serviceId: string) {
  await dataDeleteService(serviceId);
  revalidatePath("/servicios");
  revalidatePath("/");
  redirect("/servicios");
}
