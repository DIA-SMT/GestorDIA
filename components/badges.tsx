import {
  PAYMENT_STATUS_LABELS,
  SERVICE_STATUS_LABELS,
  type PaymentStatus,
  type ServiceStatus,
} from "@/lib/types";

const paymentColors: Record<PaymentStatus, { bg: string; fg: string }> = {
  paid: { bg: "rgba(16,185,129,.15)", fg: "#34d399" },
  pending: { bg: "rgba(245,158,11,.15)", fg: "#fbbf24" },
  failed: { bg: "rgba(239,68,68,.15)", fg: "#f87171" },
  refunded: { bg: "rgba(148,163,184,.15)", fg: "#cbd5e1" },
};

const serviceColors: Record<ServiceStatus, { bg: string; fg: string }> = {
  active: { bg: "rgba(16,185,129,.15)", fg: "#34d399" },
  paused: { bg: "rgba(245,158,11,.15)", fg: "#fbbf24" },
  cancelled: { bg: "rgba(148,163,184,.15)", fg: "#cbd5e1" },
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const c = paymentColors[status];
  return (
    <span className="badge" style={{ background: c.bg, color: c.fg }}>
      {PAYMENT_STATUS_LABELS[status]}
    </span>
  );
}

export function ServiceStatusBadge({ status }: { status: ServiceStatus }) {
  const c = serviceColors[status];
  return (
    <span className="badge" style={{ background: c.bg, color: c.fg }}>
      {SERVICE_STATUS_LABELS[status]}
    </span>
  );
}

export function CategoryTag({
  name,
  color,
}: {
  name: string;
  color: string;
}) {
  return (
    <span
      className="badge"
      style={{ background: color + "22", color, border: `1px solid ${color}55` }}
    >
      {name}
    </span>
  );
}
