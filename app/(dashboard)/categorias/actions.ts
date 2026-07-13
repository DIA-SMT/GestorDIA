"use server";

import { revalidatePath } from "next/cache";
import {
  createCategory as dataCreateCategory,
  updateCategory as dataUpdateCategory,
  deleteCategory as dataDeleteCategory,
} from "@/lib/data";

type FormState = { error?: string; success?: string };

function str(v: FormDataEntryValue | null): string {
  return v == null ? "" : String(v).trim();
}

export async function createCategory(_prev: unknown, formData: FormData): Promise<FormState> {
  const name = str(formData.get("name"));
  const color = str(formData.get("color")) || "#6366f1";
  if (!name) return { error: "El nombre es obligatorio." };

  const res = await dataCreateCategory(name, color);
  if (res.error) return { error: res.error };

  revalidatePath("/categorias");
  return { success: "Categoría creada." };
}

export async function updateCategory(id: string, formData: FormData) {
  const name = str(formData.get("name"));
  const color = str(formData.get("color")) || "#6366f1";
  if (!name) return;

  await dataUpdateCategory(id, name, color);
  revalidatePath("/categorias");
}

export async function deleteCategory(id: string) {
  await dataDeleteCategory(id);
  revalidatePath("/categorias");
}
