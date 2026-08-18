"use client";

// Navegación lateral colapsable.
//
// El estado colapsado vive en localStorage y lo aplica un script pre-paint en
// app/layout.tsx (atributo data-sidebar en <html>), así no se ve abrir y cerrar
// en cada navegación. En mobile se comporta como cajón modal con overlay.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/(dashboard)/actions";

const LS_KEY = "gestordia:sidebar";

const links = [
  { href: "/", label: "Dashboard", icon: IconHome },
  { href: "/pagos", label: "Pagos", icon: IconCard },
  { href: "/servicios", label: "Servicios", icon: IconRepeat },
  { href: "/rendicion", label: "Rendición", icon: IconDoc },
  { href: "/rendicion/historial", label: "Presentadas", icon: IconArchive },
  { href: "/categorias", label: "Categorías", icon: IconTag },
];

export default function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();
  // `null` = todavía no sabemos (el HTML del server no puede conocer el
  // localStorage). Hasta que hidrate no se anuncia ningún estado, en vez de
  // afirmar "expandido" mientras el sidebar se ve colapsado.
  const [collapsed, setCollapsed] = useState<boolean | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [esMobile, setEsMobile] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);

  // Se lee el estado que ya dejó puesto el script pre-paint
  useEffect(() => {
    setCollapsed(document.documentElement.dataset.sidebar === "collapsed");
  }, []);

  // El cajón solo existe por debajo de 900px (mismo corte que globals.css).
  // Se observa el viewport para poder cerrarlo al pasar a desktop: si no, el
  // scroll del body queda bloqueado y el cajón invisible sigue "abierto".
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const aplicar = () => {
      setEsMobile(mq.matches);
      if (!mq.matches) setMobileOpen(false);
    };
    aplicar();
    mq.addEventListener("change", aplicar);
    return () => mq.removeEventListener("change", aplicar);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !(prev ?? document.documentElement.dataset.sidebar === "collapsed");
      const root = document.documentElement;
      if (next) root.dataset.sidebar = "collapsed";
      else delete root.dataset.sidebar;
      try {
        localStorage.setItem(LS_KEY, next ? "collapsed" : "expanded");
      } catch {
        // modo privado o storage lleno: el estado vale para esta sesión y listo
      }
      return next;
    });
  }, []);

  // El cajón se cierra al navegar
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Cajón mobile = diálogo modal: Escape cierra, el foco queda atrapado adentro,
  // el scroll del fondo se bloquea y al salir se devuelve el foco.
  useEffect(() => {
    if (!mobileOpen) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    asideRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      // Trampa de foco: sin esto el tabulador se escapa al contenido de atrás,
      // que está tapado por el overlay y no se ve.
      const panel = asideRef.current;
      if (!panel) return;
      const foco = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (foco.length === 0) return;
      const primero = foco[0];
      const ultimo = foco[foco.length - 1];
      const activo = document.activeElement;
      if (e.shiftKey && (activo === primero || activo === panel)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && activo === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previo;
      burgerRef.current?.focus();
    };
  }, [mobileOpen]);

  // El detalle de una rendición cerrada (/rendicion/<id>) pertenece a
  // "Presentadas", no al armado. Se remapea antes de comparar.
  const ruta = pathname.startsWith("/rendicion/") ? "/rendicion/historial" : pathname;
  // Gana el prefijo MÁS LARGO: si no, "Rendición" quedaría encendida también
  // estando en "Presentadas", que ahora tiene entrada propia.
  const hrefActivo = links
    .filter((l) => (l.href === "/" ? ruta === "/" : ruta === l.href || ruta.startsWith(l.href + "/")))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const isActive = (href: string) => href === hrefActivo;

  return (
    <>
      {/* Barra superior solo en mobile: el cajón está cerrado por defecto */}
      <div className="mobile-bar">
        <button
          ref={burgerRef}
          type="button"
          className="btn btn-ghost"
          style={{ padding: "0.4rem 0.6rem" }}
          aria-label="Abrir menú"
          aria-expanded={mobileOpen}
          aria-controls="sidebar-nav"
          onClick={() => setMobileOpen(true)}
        >
          ☰
        </button>
        <Link href="/" className="font-display" style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 700 }}>
          <Image src="/brand/muni.png" alt="" width={22} height={23} />
          gestor<span className="grad-text">DIA</span>
        </Link>
      </div>

      {mobileOpen && (
        <button
          type="button"
          className="sidebar-overlay"
          aria-label="Cerrar menú"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        id="sidebar-nav"
        ref={asideRef}
        className="sidebar"
        data-open={mobileOpen ? "true" : "false"}
        tabIndex={-1}
        aria-label="Navegación principal"
        // En mobile cerrado el panel está fuera de pantalla pero sus links
        // seguían siendo tabulables: el foco se iba a controles invisibles.
        inert={esMobile && !mobileOpen}
        role={esMobile && mobileOpen ? "dialog" : undefined}
        aria-modal={esMobile && mobileOpen ? true : undefined}
      >
        {/* Marca */}
        <Link
          href="/"
          className="font-display"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            fontWeight: 700,
            fontSize: "1.05rem",
            letterSpacing: "-0.03em",
            padding: "0.35rem 0.7rem 0.9rem",
            minWidth: 0,
          }}
          title="gestorDIA"
        >
          <Image src="/brand/muni.png" alt="" width={24} height={25} priority style={{ flex: "0 0 auto" }} />
          <span className="sidebar-label">
            gestor<span className="grad-text">DIA</span>
          </span>
        </Link>

        <nav style={{ display: "grid", gap: "0.2rem" }}>
          {links.map((l) => {
            const Icon = l.icon;
            const activo = isActive(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className="sidebar-link"
                aria-current={activo ? "page" : undefined}
                title={l.label}
                style={{ position: "relative" }}
              >
                <span className="icon" aria-hidden>
                  <Icon />
                </span>
                <span className="sidebar-label">{l.label}</span>
              </Link>
            );
          })}
        </nav>

        <Link
          href="/pagos/nuevo"
          className="btn btn-primary"
          style={{ marginTop: "0.7rem", padding: "0.55rem 0.6rem" }}
          title="Registrar pago"
        >
          <span aria-hidden>+</span>
          <span className="sidebar-label">Registrar pago</span>
        </Link>

        {/* Pie */}
        <div style={{ marginTop: "auto", display: "grid", gap: "0.5rem", paddingTop: "1rem" }}>
          <span
            className="sidebar-label"
            style={{ fontSize: "0.72rem", color: "var(--text-faint)", padding: "0 0.7rem", wordBreak: "break-all" }}
          >
            {email}
          </span>
          <form action={signOut}>
            <button
              type="submit"
              className="btn btn-ghost"
              style={{ width: "100%", padding: "0.45rem 0.6rem" }}
              title="Salir"
            >
              <span aria-hidden>⏻</span>
              <span className="sidebar-label">Salir</span>
            </button>
          </form>
          <button
            type="button"
            className="sidebar-toggle sidebar-only-desktop"
            onClick={toggleCollapsed}
            // Hasta que hidrate no se afirma un estado que puede ser el opuesto
            // al que se está viendo (el pre-paint ya pudo dejarlo colapsado).
            aria-expanded={collapsed === null ? undefined : !collapsed}
            aria-controls="sidebar-nav"
            title={collapsed === null ? "Colapsar o expandir menú" : collapsed ? "Expandir menú" : "Colapsar menú"}
          >
            <span aria-hidden style={{ fontSize: "0.9rem" }}>{collapsed ? "»" : "«"}</span>
            <span className="sidebar-label" style={{ marginLeft: "0.5rem", fontSize: "0.8rem" }}>
              Colapsar
            </span>
          </button>
        </div>
      </aside>
    </>
  );
}

/* ---------- Iconos (inline: no hay librería de iconos en el proyecto) ------- */
const svg = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IconHome() {
  return (
    <svg {...svg}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}
function IconCard() {
  return (
    <svg {...svg}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 10h19" />
    </svg>
  );
}
function IconRepeat() {
  return (
    <svg {...svg}>
      <path d="M17 2.5 20.5 6 17 9.5" />
      <path d="M3.5 12V9a3 3 0 0 1 3-3h14" />
      <path d="M7 21.5 3.5 18 7 14.5" />
      <path d="M20.5 12v3a3 3 0 0 1-3 3h-14" />
    </svg>
  );
}
function IconDoc() {
  return (
    <svg {...svg}>
      <path d="M14 2.5H7A1.5 1.5 0 0 0 5.5 4v16A1.5 1.5 0 0 0 7 21.5h10a1.5 1.5 0 0 0 1.5-1.5V7z" />
      <path d="M14 2.5V7h4.5" />
      <path d="M8.5 13h7M8.5 17h7" />
    </svg>
  );
}
function IconArchive() {
  return (
    <svg {...svg}>
      <path d="M3.5 7.5h17v12a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" />
      <path d="M2.5 4.5h19v3h-19zM9.5 12h5" />
    </svg>
  );
}
function IconTag() {
  return (
    <svg {...svg}>
      <path d="M3 12.5V4a1 1 0 0 1 1-1h8.5L21 11.5 12.5 20z" />
      <circle cx="7.5" cy="7.5" r="1.4" />
    </svg>
  );
}
