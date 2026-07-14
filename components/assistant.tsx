"use client";

// Asistente virtual flotante: botón abajo a la derecha que abre un chat.
// Pregunta sobre gastos, servicios y rendiciones; responde /api/chat
// con streaming de texto plano.

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const SUGERENCIAS = [
  "¿Cuánto gastamos este mes?",
  "¿Qué falta rendir?",
  "¿Qué servicios renuevan pronto?",
];

export default function Assistant() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setError(null);
    setInput("");
    const history: Msg[] = [...messages, { role: "user", content: question }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, path: pathname }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Error HTTP ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const current = acc;
        setMessages([...history, { role: "assistant", content: current }]);
      }
      if (!acc.trim()) throw new Error("El modelo devolvió una respuesta vacía.");
    } catch (e) {
      setMessages(history); // saca la burbuja vacía del asistente
      setError(e instanceof Error ? e.message : "No se pudo consultar al asistente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Botón flotante */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={open ? "Cerrar asistente" : "Abrir asistente"}
        title="Asistente DIA"
        className={`assistant-fab${open ? " is-open" : ""}`}
      >
        {open ? (
          <span style={{ color: "#fff", fontSize: "1.25rem", lineHeight: 1 }}>✕</span>
        ) : (
          <Image src="/brand/bot.png" alt="" width={36} height={25} style={{ filter: "brightness(4)" }} />
        )}
      </button>

      {/* Panel de chat */}
      {open && (
        <div
          className="card assistant-panel"
          style={{
            position: "fixed",
            bottom: "5.6rem",
            right: "1.4rem",
            zIndex: 40,
            width: "min(380px, calc(100vw - 2rem))",
            height: "min(540px, calc(100vh - 8rem))",
            display: "flex",
            flexDirection: "column",
            background: "rgba(8, 11, 24, 0.92)",
            backdropFilter: "blur(20px) saturate(150%)",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.9rem 1.1rem", borderBottom: "1px solid var(--glass-border)" }}>
            <Image src="/brand/bot.png" alt="" width={30} height={21} />
            <div>
              <div className="font-display" style={{ fontWeight: 600, fontSize: "0.95rem" }}>Asistente DIA</div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Preguntale sobre gastos, servicios y rendiciones</div>
            </div>
          </div>

          {/* Mensajes */}
          <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "1rem 1.1rem", display: "flex", flexDirection: "column", gap: "0.65rem" }}>
            {messages.length === 0 && (
              <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.5rem" }}>
                <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: 0 }}>
                  Hola 👋 Puedo responder con los datos cargados en gestorDIA. Probá con:
                </p>
                {SUGERENCIAS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="btn btn-ghost"
                    style={{ justifyContent: "flex-start", fontSize: "0.82rem", fontWeight: 500, padding: "0.5rem 0.75rem" }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  padding: "0.55rem 0.8rem",
                  borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                  background: m.role === "user" ? "var(--grad-primary)" : "rgba(255,255,255,0.06)",
                  border: m.role === "user" ? "none" : "1px solid var(--glass-border)",
                  color: m.role === "user" ? "#fff" : "var(--text)",
                  fontSize: "0.86rem",
                  lineHeight: 1.45,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {m.content || <PensandoDots />}
              </div>
            ))}
            {error && (
              <p style={{ color: "#f87171", fontSize: "0.8rem", margin: 0 }}>{error}</p>
            )}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            style={{ display: "flex", gap: "0.5rem", padding: "0.8rem 1.1rem", borderTop: "1px solid var(--glass-border)" }}
          >
            <input
              className="input"
              placeholder="Escribí tu pregunta…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()} style={{ padding: "0.6rem 0.9rem" }}>
              {busy ? "…" : "➤"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}

function PensandoDots() {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }} aria-label="Pensando…">
      <Dot delay="0s" />
      <Dot delay="0.15s" />
      <Dot delay="0.3s" />
      <style>{`@keyframes pulseDot { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }`}</style>
    </span>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "var(--primary)",
        animation: `pulseDot 1s ease-in-out ${delay} infinite`,
      }}
    />
  );
}
