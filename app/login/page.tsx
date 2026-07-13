"use client";

import { useActionState, useState } from "react";
import { signIn, signUp } from "./actions";

const initialState: { error?: string; success?: string } = {};

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const action = mode === "signin" ? signIn : signUp;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: "1fr",
        placeItems: "center",
        padding: "1.5rem",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 960,
          display: "grid",
          gridTemplateColumns: "1.1fr 1fr",
          gap: "2rem",
          alignItems: "center",
        }}
        className="login-grid"
      >
        {/* Hero */}
        <div className="login-hero">
          <span
            className="badge"
            style={{ background: "var(--glass)", border: "1px solid var(--glass-border)", color: "var(--text-muted)", marginBottom: "1.4rem" }}
          >
            Pagos · Suscripciones · Rendición
          </span>
          <h1
            className="font-display"
            style={{ fontSize: "clamp(2.6rem, 6vw, 4.2rem)", fontWeight: 700, lineHeight: 1.02, margin: 0 }}
          >
            gestor<span className="grad-text">DIA</span>
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: "1.05rem", marginTop: "1.1rem", maxWidth: 420, lineHeight: 1.5 }}>
            El control de todos los pagos del equipo en un solo lugar. Discriminá por
            categoría, seguí las renovaciones, guardá los comprobantes y tené la
            rendición lista para el contador.
          </p>
        </div>

        {/* Formulario */}
        <div className="card" style={{ padding: "2rem" }}>
          <h2 className="font-display" style={{ fontSize: "1.35rem", fontWeight: 600 }}>
            {mode === "signin" ? "Iniciar sesión" : "Crear cuenta"}
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", marginTop: 4, marginBottom: "1.4rem" }}>
            {mode === "signin" ? "Entrá con tu email del equipo." : "Registrate para sumarte al equipo."}
          </p>

          <form action={formAction} style={{ display: "grid", gap: "0.9rem" }}>
            {mode === "signup" && (
              <div>
                <label className="label" htmlFor="full_name">Nombre</label>
                <input id="full_name" name="full_name" className="input" placeholder="Tu nombre" required />
              </div>
            )}
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" className="input" placeholder="vos@empresa.com" required />
            </div>
            <div>
              <label className="label" htmlFor="password">Contraseña</label>
              <input id="password" name="password" type="password" className="input" placeholder="••••••••" minLength={6} required />
            </div>

            {state?.error && <p style={{ color: "#fca5a5", fontSize: "0.85rem" }}>{state.error}</p>}
            {state?.success && <p style={{ color: "#6ee7b7", fontSize: "0.85rem" }}>{state.success}</p>}

            <button type="submit" className="btn btn-primary" disabled={pending} style={{ marginTop: "0.3rem" }}>
              {pending ? "Procesando…" : mode === "signin" ? "Entrar" : "Crear cuenta"}
            </button>
          </form>

          <p style={{ marginTop: "1.3rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
            {mode === "signin" ? "¿No tenés cuenta? " : "¿Ya tenés cuenta? "}
            <button
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              style={{ color: "var(--primary)", fontWeight: 600 }}
            >
              {mode === "signin" ? "Registrate" : "Iniciá sesión"}
            </button>
          </p>
        </div>
      </div>

      <style>{`
        @media (max-width: 780px) {
          .login-grid { grid-template-columns: 1fr !important; }
          .login-hero { text-align: center; }
          .login-hero p { margin-left: auto; margin-right: auto; }
        }
      `}</style>
    </main>
  );
}
