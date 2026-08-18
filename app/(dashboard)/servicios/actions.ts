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
import type { ServiceStatus } from "@/lib/types";

function str(v: FormDataEntryValue | null): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

function parseInput(formData: FormData): ServiceInput {
  return {
    name: str(formData.get("name")) ?? "Servicio",
    description: str(formData.get("description")),
    url: str(formData.get("url")),
    category_id: str(formData.get("category_id")),
    status: (str(formData.get("status")) ?? "active") as ServiceStatus,
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
