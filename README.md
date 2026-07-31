# gestorDIA

Sistema para **registrar y hacer seguimiento de los pagos con tarjeta** del equipo
(credenciales, suscripciones, servicios). Permite discriminar por categoría,
distinguir la suscripción del pago concreto, guardar el link de donde se pagó,
adjuntar recibos y ver próximas renovaciones.

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
| `services`   | La suscripción/servicio: ciclo, monto esperado, estado, día de cobro y **ancla** del próximo ciclo sin confirmar. |
| `payments`   | Cada pago concreto: monto, moneda, cotización, equivalente en ARS, fecha, link, estado, recibos, y el `cycle_date` si nació de un cargo recurrente. |
| `receipts`   | Comprobantes subidos a Supabase Storage, linkeados al pago. |
| `service_cycle_skips` | Ciclos omitidos a propósito (para saber por qué un mes no generó gasto). |

Un **servicio** agrupa muchos **pagos** en el tiempo. Los pagos sueltos van sin servicio.

### Cómo funcionan los cargos recurrentes

`services.next_renewal_date` es una **marca de agua**: es el primer ciclo que
todavía nadie confirmó. Todo lo anterior ya está resuelto.

- Los cargos pendientes **no se guardan**: se derivan de esa fecha + el ciclo.
  Nada se crea solo, ni siquiera al abrir la app.
- **Confirmar** crea el pago con la **fecha del ciclo** (no la de hoy) y corre el
  ancla un ciclo. Un `unique (service_id, cycle_date)` impide confirmarlo dos veces.
- `billing_anchor_day` guarda el día real de cobro. Sin esa columna, un servicio
  que cobra el 31 quedaría fijado al 28 después de pasar por febrero.
- Un cargo por confirmar **no es un pago**: no suma en los totales ni entra en la
  rendición hasta que se confirma.

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
4. [`0004_cargos_recurrentes.sql`](supabase/migrations/0004_cargos_recurrentes.sql) — cargos recurrentes por confirmar.

Todas son idempotentes: se pueden volver a correr sin romper nada. Si te falta la
0004, la app avisa arriba de los cargos y funciona en modo degradado (un solo
ciclo por servicio, sin protección contra doble confirmación).

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

- **Cargos recurrentes por confirmar**: cuando un servicio mensual/anual vuelve a
  renovar, el gasto aparece propuesto en el dashboard esperando el OK. Confirmalo
  (crea el pago del período, heredando proveedor, CUIT, comprobante y cotización del
  pago anterior), omitilo, o dá el servicio de baja si ya no se usa. Un anual se
  propone una vez al año; uno mensual, una vez por mes. Si quedaron meses atrasados
  se proponen todos, cada uno con su fecha, y hay un "poner al día" para saltearlos.
- **Dashboard** con gasto del mes (ARS y USD), servicios activos y próximas renovaciones.
- **Pagos**: alta con monto + moneda + cotización, cálculo automático del equivalente
  en pesos, link de donde se pagó, estado, medio de pago, notas y **recibos adjuntos**.
  Botón para traer el **dólar tarjeta** automáticamente (dolarapi.com).
- **Servicios/suscripciones**: ciclo de facturación, próxima renovación, estado
  (activa/pausada/cancelada), historial de pagos por servicio.
- **Rendición de cuentas**: por cada pago se guarda **proveedor, CUIT, tipo y número
  de comprobante**. La vista **Rendición** arma el detalle del mes con totales.
  El botón **"PDF para imprimir y rendir"** genera el PDF (con los recibos
  incrustados) y deja esos pagos marcados como presentados, con una barra de
  **deshacer** y un **reimprimir** para cuando el contador lo vuelve a pedir. Hay
  también una **vista previa que no marca nada** y exportación a CSV.
  Solo se rinden los pagos en estado *Pagado*: los pendientes o fallidos quedan
  afuera y vuelven a aparecer cuando se confirmen.
- **Categorías**: crear/editar/borrar con color.
- **Filtros** en el listado de pagos (búsqueda, categoría, estado, moneda).
- **Recibos privados** en Supabase Storage con URLs firmadas temporales.
- **Sidebar colapsable**: navegación lateral con badge de cargos por confirmar. El
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
