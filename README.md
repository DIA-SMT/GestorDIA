# gestorDIA

Sistema para **registrar y hacer seguimiento de los pagos con tarjeta** del equipo
(credenciales, suscripciones, servicios). Permite discriminar por categoría,
distinguir la suscripción del pago concreto, guardar el link de donde se pagó,
adjuntar las facturas y armar la rendición para el contador.

**Stack:** Next.js (App Router) · Supabase (Postgres + Auth + Storage) · Vercel.

> ### 🧪 Modo demo (sin configurar nada)
> Si corrés la app **sin credenciales de Supabase**, arranca en **modo demo**: sin
> login y con datos de ejemplo en memoria (podés crear, editar y borrar; se reinician
> al reiniciar el server). Ideal para ver y testear la UI antes de crear la base.
> Apenas completás `.env.local` con tu proyecto de Supabase, pasa **solo** a modo real.
> Basta con `npm install && npm run dev`.

---

## Modelo de datos

| Tabla        | Qué guarda |
|--------------|-----------|
| `profiles`   | Usuarios del equipo (extiende `auth.users`). |
| `categories` | Categorías para discriminar (IA, Hosting, Dominios…). |
| `services`   | El servicio: solo agrupa pagos (nombre, categoría, URL, estado). |
| `payments`   | Cada pago concreto: monto, moneda, cotización, equivalente en ARS, fecha, link, estado, datos de facturación y recibos. |
| `receipts`   | Comprobantes subidos a Supabase Storage, linkeados al pago. |
| `rendiciones` | Cada entrega al contador: número, fecha de presentación, período que cubre, totales congelados y el PDF archivado. |

Un **servicio** agrupa muchos **pagos** en el tiempo. Los pagos sueltos van sin servicio.
Una **rendición** agrupa los pagos de una entrega (`payments.rendicion_id`).

### Cómo funciona la rendición

El circuito real no es mensual: el gasto se anota cuando se paga (que es cuando
se sabe el monto) y las facturas llegan después, cuando el contador las pide.

- La pantalla **Rendición** muestra **todo lo pendiente**, de cualquier período.
  Un gasto de enero cuya factura llegó en marzo sigue a la vista; no hay que
  acordarse de volver a enero. El filtro de período es opcional.
- Cada pago dice **qué le falta** para que el contador lo acepte, y se completa
  ahí mismo. Faltar el tipo de comprobante, el N° o el archivo adjunto es
  bloqueante (avisa y pide confirmar); faltar proveedor, CUIT o cotización, no.
- **Rendir cierra un lote numerado**: se crea la `rendicion`, se le enganchan los
  pagos, se genera el PDF con las facturas incrustadas y se archiva una copia.
- Los totales del lote quedan **congelados**. Si después se corrige la cotización
  de un pago, la rendición Nº 7 sigue diciendo lo que decía el papel entregado, y
  la ficha avisa que el detalle de hoy no coincide.
- Reabrir un lote devuelve sus pagos a la cola. Sacar un solo pago (el que el
  contador rebotó) recalcula los totales del lote.

### Cómo se cargan los gastos

**Cada gasto se carga a mano, cuando se paga.** No hay cargos automáticos ni
suscripciones que se generen solas.

Se probó el camino contrario —servicios con ciclo, monto esperado y cargos
propuestos esperando confirmación— y no servía para este caso: el monto real
cambia todos los meses (se suman o se sacan asientos, cambia el consumo), así
que el sistema proponía siempre el número equivocado y corregirlo costaba más
que cargar el pago de cero.

Para lo que se repite está **"↻ Repetir"**, en cada pago de la lista, del
detalle y del historial del servicio. Abre el formulario con todos los datos del
pago original —servicio, categoría, descripción, monto, moneda, cotización,
proveedor, CUIT, tipo de comprobante— con la fecha en **hoy** y el **N° de
comprobante vacío**, porque cambia en cada factura y arrastrarlo sería rendir un
número que no corresponde.

El dashboard cierra el circuito: lista **lo que se pagó el mes pasado y este mes
todavía no**, comparando por proveedor + descripción. No es una alerta de
vencimiento —puede que este mes no corresponda— sino el recordatorio de qué
falta cargar, cada uno con su botón de repetir.

> Las columnas del esquema viejo (`billing_cycle`, `next_renewal_date`,
> `expected_amount`, `payment_mode`, `billing_anchor_day`, `payments.cycle_date`)
> y la tabla `service_cycle_skips` **siguen en la base**: no se borró nada,
> simplemente no se usan. Tienen `default` en el esquema, así que no hizo falta
> ninguna migración para dejar de escribirlas.

---

## Puesta en marcha

### 1. Crear el proyecto en Supabase
1. Entrá a [supabase.com](https://supabase.com) → **New project**.
2. En **Project Settings → API** copiá el **Project URL** y la **anon public key**.

### 2. Variables de entorno
Copiá el ejemplo y completá con tus valores:

```bash
cp .env.local.example .env.local
```

```
NEXT_PUBLIC_SUPABASE_URL=https://TU-PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu-anon-key
```

### 3. Aplicar el esquema de base de datos
Abrí el **SQL Editor** en el dashboard de Supabase y ejecutá **en orden** el
contenido de cada archivo de [`supabase/migrations/`](supabase/migrations/):

1. [`0001_init.sql`](supabase/migrations/0001_init.sql) — tablas, RLS, bucket de recibos y categorías iniciales.
2. [`0002_on_demand.sql`](supabase/migrations/0002_on_demand.sql) — ciclo "recarga a demanda".
3. [`0003_rendido.sql`](supabase/migrations/0003_rendido.sql) — marca de rendición.
4. [`0004_cargos_recurrentes.sql`](supabase/migrations/0004_cargos_recurrentes.sql) — histórica: creó las columnas de recurrencia. La app ya no las usa, pero correrla no molesta y las bases existentes las tienen.
5. [`0005_rendiciones.sql`](supabase/migrations/0005_rendiciones.sql) — la rendición como lote numerado, con historial y PDF archivado.

Todas son idempotentes: se pueden volver a correr sin romper nada. Si te falta la
0005, se puede rendir igual pero los pagos se marcan sueltos: sin número, sin
historial y sin PDF archivado.

> La 0005 **no borra nada** y además **recupera las entregas viejas**: agrupa los
> pagos ya rendidos por su `rendido_at` exacto (los marcados en una misma tanda
> comparten el timestamp) y arma una rendición por cada una, así el historial no
> arranca vacío.

### 4. Instalar y correr

```bash
npm install
npm run dev
```

Abrí <http://localhost:3000>. Te va a llevar al login: **registrate** con tu email
y contraseña (Supabase Auth). Cada persona del equipo se crea su cuenta.

> **Tip:** en Supabase → **Authentication → Providers → Email**, si querés que el
> equipo entre sin confirmar el mail, desactivá "Confirm email". Para producción
> conviene dejarlo activado.

### 5. Deploy en Vercel
1. Subí el repo a GitHub y conectalo en [vercel.com](https://vercel.com).
2. Cargá las mismas variables de entorno (`NEXT_PUBLIC_SUPABASE_URL` y
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`) en **Settings → Environment Variables**.
3. Deploy. Listo.

---

## Funcionalidades

- **Repetir un gasto**: botón `↻` en cada pago. Precarga todo lo que se mantiene
  mes a mes y limpia lo que no (fecha en hoy, N° de comprobante en blanco). El
  dashboard lista lo que se pagó el mes pasado y este mes todavía no.
- **Dashboard** con gasto del mes (ARS y USD), pendiente de rendir, cuántos pagos
  están sin factura y servicios activos. Cada KPI se abre y muestra qué lo compone.
- **Pagos**: alta con monto + moneda + cotización, cálculo automático del equivalente
  en pesos, link de donde se pagó, estado, medio de pago, notas y **recibos adjuntos**.
  Botón para traer el **dólar tarjeta** automáticamente (dolarapi.com).
- **Servicios**: agrupan pagos para ver el historial y el total gastado en cada
  uno. Nombre, categoría, URL, estado y notas — nada de ciclos ni montos esperados.
- **Rendición de cuentas**: por cada pago se guarda **proveedor, CUIT, tipo y número
  de comprobante**. La vista **Rendición** lista todo lo pendiente de cualquier
  período, agrupado por mes con subtotales, y marca con chips **qué le falta a
  cada pago** para que el contador lo acepte — completables ahí mismo con el
  lápiz de la fila, sin abrir la ficha. El botón **"Rendir y generar
  comprobante"** cierra un **lote numerado**, baja el PDF con las facturas
  incrustadas y archiva la copia. Hay **vista previa** que no cierra nada y
  exportación a CSV (con la columna de qué falta). Solo se rinden los pagos en
  estado *Pagado*.
- **Historial de rendiciones** (`/rendicion/historial`): cada entrega con su
  número, fecha, período cubierto y total. Desde la ficha de un lote se
  **descarga el comprobante entregado** (el PDF archivado, tal cual se imprimió),
  se **reimprime** con los datos de hoy, se **saca** un pago que el contador
  rebotó, o se **reabre** la rendición entera.
- **Categorías**: crear/editar/borrar con color.
- **Filtros** en el listado de pagos (búsqueda, categoría, estado, moneda).
- **Recibos privados** en Supabase Storage con URLs firmadas temporales.
- **Sidebar colapsable**: navegación lateral con accesos separados a *Rendición*
  (armar) y *Presentadas* (historial). El
  estado colapsado se recuerda (localStorage, aplicado antes del primer pintado para
  que no parpadee) y en mobile pasa a ser un cajón con overlay, Escape y foco.
- **Diseño "liquid"**: fondo animado, glassmorphism y tipografía moderna.

---

## Ideas para las próximas versiones

- Mandarle el PDF al contador por email desde la app (hoy es descarga manual).
- Avisos por email antes de cada renovación (Supabase cron / Edge Functions).
- Reportes: gasto por mes y por categoría con gráficos.
- Exportar a CSV/Excel para conciliar con el resumen de la tarjeta.
- Cotización guardada por fecha (histórico) para reportes en pesos más precisos.
- Roles (admin vs. miembro) si hace falta restringir quién borra.
