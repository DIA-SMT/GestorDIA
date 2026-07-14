"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut } from "./actions";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/pagos", label: "Pagos" },
  { href: "/servicios", label: "Servicios" },
  { href: "/rendicion", label: "Rendición" },
  { href: "/categorias", label: "Categorías" },
];

export default function Nav({ email }: { email: string }) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        background: "rgba(8, 11, 24, 0.55)",
        borderBottom: "1px solid var(--glass-border)",
        backdropFilter: "blur(18px) saturate(160%)",
        WebkitBackdropFilter: "blur(18px) saturate(160%)",
      }}
    >
      <div
        style={{
          maxWidth: 1440,
          margin: "0 auto",
          padding: "0.8rem 2.5rem",
          display: "flex",
          alignItems: "center",
          gap: "1.5rem",
        }}
      >
        <Link
          href="/"
          className="font-display"
          style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontWeight: 700, fontSize: "1.1rem", letterSpacing: "-0.03em" }}
        >
          <Image src="/brand/muni.png" alt="Municipalidad de San Miguel de Tucumán" width={26} height={27} priority />
          <span>
            gestor<span className="grad-text">DIA</span>
          </span>
        </Link>

        <nav style={{ display: "flex", gap: "0.15rem", flex: 1, overflowX: "auto" }}>
          {links.map((l) => {
            const active = isActive(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                style={{
                  padding: "0.42rem 0.8rem",
                  borderRadius: 10,
                  fontSize: "0.88rem",
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  color: active ? "var(--text)" : "var(--text-muted)",
                  background: active ? "var(--glass-strong)" : "transparent",
                  border: active ? "1px solid var(--glass-border)" : "1px solid transparent",
                }}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ fontSize: "0.78rem", color: "var(--text-faint)" }}>{email}</span>
          <form action={signOut}>
            <button type="submit" className="btn btn-ghost" style={{ padding: "0.42rem 0.75rem" }}>
              Salir
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
