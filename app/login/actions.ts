"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type FormState = { error?: string; success?: string };

export async function signIn(_prev: unknown, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: traducirError(error.message) };
  }
  redirect("/");
}

export async function signUp(_prev: unknown, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });

  if (error) {
    return { error: traducirError(error.message) };
  }
  return {
    success:
      "Cuenta creada. Si tu proyecto pide confirmación por email, revisá tu casilla. Si no, ya podés iniciar sesión.",
  };
}

function traducirError(msg: string): string {
  if (msg.includes("Invalid login credentials"))
    return "Email o contraseña incorrectos.";
  if (msg.includes("already registered"))
    return "Ese email ya está registrado.";
  if (msg.includes("Password should be"))
    return "La contraseña debe tener al menos 6 caracteres.";
  return msg;
}
