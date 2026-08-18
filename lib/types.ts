// Tipos que reflejan el esquema de la base de datos

export type ServiceStatus = "active" | "paused" | "cancelled";

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

/**
 * Un servicio AGRUPA pagos: entrás a "Cursor Pro" y ves todo lo que se le pagó.
 *
 * No modela una suscripción con ciclo ni propone cargos. Se probó ese camino y
 * no servía para este caso: el monto real cambia todos los meses (se suman o
 * se sacan asientos, cambia el consumo), así que un "monto esperado" fijo
 * proponía siempre el número equivocado y corregirlo costaba más que cargar el
 * pago a mano. Los gastos se cargan cuando se pagan, y para los que se repiten
 * está el botón "Repetir" de cada pago.
 *
 * Las columnas del esquema viejo (billing_cycle, next_renewal_date,
 * expected_amount, payment_mode, billing_anchor_day) siguen en la base con sus
 * valores por defecto: no se borró nada, simplemente no se usan.
 */
export interface Service {
  id: string;
  name: string;
  description: string | null;
  url: string | null;
  category_id: string | null;
  status: ServiceStatus;
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
  // Lote de rendición al que pertenece (migración 0005). `rendido_at` dice
  // "ya se presentó"; esto dice "en qué entrega". Puede ser null en pagos
  // marcados antes de la 0005 en una base sin migrar.
  rendicion_id?: string | null;
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

/**
 * Una entrega al contador. Es un LOTE cerrado: los pagos que incluye, el
 * período que realmente cubre (no un mes calendario), los totales congelados
 * al momento de entregarla y el PDF exacto que se imprimió.
 *
 * Congelar los totales es a propósito: si mañana se corrige la cotización de un
 * pago, la rendición Nº 7 tiene que seguir diciendo lo que decía el papel.
 */
export interface Rendicion {
  id: string;
  numero: number;
  titulo: string | null;
  notas: string | null;
  periodo_desde: string;
  periodo_hasta: string;
  cantidad: number;
  total_ars: number;
  total_usd: number;
  /** Ruta del PDF en el bucket 'rendiciones'. null = no se llegó a archivar. */
  pdf_path: string | null;
  presentada_at: string;
  created_by: string | null;
  created_at: string;
  /** Solo en el detalle */
  payments?: Payment[];
}

// Etiquetas legibles para los enums
export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  active: "Activa",
  paused: "En pausa",
  cancelled: "Cancelada",
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
