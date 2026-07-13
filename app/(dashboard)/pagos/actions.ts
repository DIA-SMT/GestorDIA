"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getCurrentUser,
  createPayment as dataCreatePayment,
  updatePayment as dataUpdatePayment,
  deletePayment as dataDeletePayment,
  deleteReceipt as dataDeleteReceipt,
  type PaymentInput,
} from "@/lib/data";
import type { CurrencyCode, PaymentStatus, ReceiptType } from "@/lib/types";

function num(v: FormDataEntryValue | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function str(v: FormDataEntryValue | null): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}
function computeArs(amount: number, currency: CurrencyCode, rate: number | null): number | null {
  if (currency === "ARS") return amount;
  if (rate == null) return null;
  return Math.round(amount * rate * 100) / 100;
}

function parseInput(formData: FormData): { input?: PaymentInput; error?: string } {
  const amount = num(formData.get("amount"));
  if (amount == null) return { error: "El monto es obligatorio." };

  const currency = (str(formData.get("currency")) ?? "USD") as CurrencyCode;
  const rate = num(formData.get("exchange_rate"));

  return {
    input: {
      service_id: str(formData.get("service_id")),
      category_id: str(formData.get("category_id")),
      description: str(formData.get("description")),
      amount,
      currency,
      exchange_rate: currency === "ARS" ? null : rate,
      amount_ars: computeArs(amount, currency, rate),
      payment_date: str(formData.get("payment_date")) ?? new Date().toISOString().slice(0, 10),
      payment_url: str(formData.get("payment_url")),
      status: (str(formData.get("status")) ?? "paid") as PaymentStatus,
      payment_method: str(formData.get("payment_method")),
      provider: str(formData.get("provider")),
      provider_tax_id: str(formData.get("provider_tax_id")),
      receipt_type: (str(formData.get("receipt_type")) ?? "sin_comprobante") as ReceiptType,
      receipt_number: str(formData.get("receipt_number")),
      notes: str(formData.get("notes")),
    },
  };
}

function receiptFiles(formData: FormData): File[] {
  return formData.getAll("receipts").filter((f): f is File => f instanceof File && f.size > 0);
}

export async function createPayment(_prev: unknown, formData: FormData) {
  const { input, error } = parseInput(formData);
  if (error || !input) return { error };

  const user = await getCurrentUser();
  const res = await dataCreatePayment(input, receiptFiles(formData), user?.id ?? null);
  if (res.error || !res.id) return { error: res.error ?? "No se pudo crear el pago." };

  revalidatePath("/pagos");
  revalidatePath("/");
  redirect(`/pagos/${res.id}`);
}

export async function updatePayment(paymentId: string, _prev: unknown, formData: FormData) {
  const { input, error } = parseInput(formData);
  if (error || !input) return { error };

  const user = await getCurrentUser();
  const res = await dataUpdatePayment(paymentId, input, receiptFiles(formData), user?.id ?? null);
  if (res.error) return { error: res.error };

  revalidatePath(`/pagos/${paymentId}`);
  revalidatePath("/pagos");
  revalidatePath("/");
  return { success: "Pago actualizado." };
}

export async function deletePayment(paymentId: string) {
  await dataDeletePayment(paymentId);
  revalidatePath("/pagos");
  revalidatePath("/");
  redirect("/pagos");
}

export async function deleteReceipt(receiptId: string, paymentId: string) {
  await dataDeleteReceipt(receiptId);
  revalidatePath(`/pagos/${paymentId}`);
}
