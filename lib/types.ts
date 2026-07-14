// Tipos que reflejan el esquema de la base de datos

export type BillingCycle =
  | "monthly"
  | "yearly"
  | "quarterly"
  | "weekly"
  | "one_time"
  | "on_demand"
  | "custom";

export type ServiceStatus = "active" | "paused" | "cancelled";

// Cómo se cobra: automático (débito en la tarjeta, se cobra solo)
// o manual (hay que acordarse de pagarlo → genera alerta)
export type PaymentMode = "automatic" | "manual";
export type PaymentStatus = "paid" | "pending" | "failed" | "refunded";
export type CurrencyCode = "USD" | "ARS" | "EUR";

// Tipo de comprobante para rendición de cuentas
export type ReceiptType =
  | "factura_a"
  | "factura_b"
  | "factura_c"
  | "ticket"
  | "recibo"
  | "nota_credito"
  | "comprobante_exterior"
  | "sin_comprobante";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  url: string | null;
  category_id: string | null;
  billing_cycle: BillingCycle;
  expected_amount: number | null;
  currency: CurrencyCode;
  status: ServiceStatus;
  payment_mode: PaymentMode;
  next_renewal_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  category?: Category | null;
}

export interface Payment {
  id: string;
  service_id: string | null;
  category_id: string | null;
  description: string | null;
  amount: number;
  currency: CurrencyCode;
  exchange_rate: number | null;
  amount_ars: number | null;
  payment_date: string;
  payment_url: string | null;
  status: PaymentStatus;
  payment_method: string | null;
  // Rendición de cuentas
  provider: string | null;          // proveedor / razón social
  provider_tax_id: string | null;   // CUIT / identificación fiscal
  receipt_type: ReceiptType;        // tipo de comprobante
  receipt_number: string | null;    // número de comprobante / factura
  paid_by: string | null;
  notes: string | null;
  rendido_at?: string | null; // cuándo se rindió al contador (null = pendiente)
  created_at: string;
  updated_at: string;
  service?: Service | null;
  category?: Category | null;
  receipts?: Receipt[];
}

export interface Receipt {
  id: string;
  payment_id: string;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
}

// Etiquetas legibles para los enums
export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: "Mensual",
  yearly: "Anual",
  quarterly: "Trimestral",
  weekly: "Semanal",
  one_time: "Único",
  on_demand: "Recarga a demanda",
  custom: "Personalizado",
};

export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  active: "Activa",
  paused: "En pausa",
  cancelled: "Cancelada",
};

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  automatic: "Débito automático",
  manual: "Pago manual",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: "Pagado",
  pending: "Pendiente",
  failed: "Fallido",
  refunded: "Reembolsado",
};

export const RECEIPT_TYPE_LABELS: Record<ReceiptType, string> = {
  factura_a: "Factura A",
  factura_b: "Factura B",
  factura_c: "Factura C",
  ticket: "Ticket / Ticket factura",
  recibo: "Recibo",
  nota_credito: "Nota de crédito",
  comprobante_exterior: "Comprobante del exterior",
  sin_comprobante: "Sin comprobante",
};
