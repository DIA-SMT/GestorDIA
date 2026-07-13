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
| `services`   | La suscripción/servicio: ciclo, monto esperado, estado, próxima renovación. |
| `payments`   | Cada pago concreto: monto, moneda, cotización, equivalente en ARS, fecha, link, estado, recibos. |
| `receipts`   | Comprobantes subidos a Supabase Storage, linkeados al pago. |

Un **servicio** agrupa muchos **pagos** en el tiempo. Los pagos sueltos van sin servicio.

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
Abrí el **SQL Editor** en el dashboard de Supabase, pegá el contenido de
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) y ejecutá.
Eso crea las tablas, las políticas de seguridad (RLS), el bucket de recibos y
unas categorías iniciales.

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

- **Dashboard** con gasto del mes (ARS y USD), servicios activos y próximas renovaciones.
- **Pagos**: alta con monto + moneda + cotización, cálculo automático del equivalente
  en pesos, link de donde se pagó, estado, medio de pago, notas y **recibos adjuntos**.
  Botón para traer el **dólar tarjeta** automáticamente (dolarapi.com).
- **Servicios/suscripciones**: ciclo de facturación, próxima renovación, estado
  (activa/pausada/cancelada), historial de pagos por servicio.
- **Rendición de cuentas**: por cada pago se guarda **proveedor, CUIT, tipo y número
  de comprobante**. La vista **Rendición** arma el detalle por período (mes), con
  totales y **exportación a CSV** lista para pasarle al contador, junto con los recibos.
- **Categorías**: crear/editar/borrar con color.
- **Filtros** en el listado de pagos (búsqueda, categoría, estado, moneda).
- **Recibos privados** en Supabase Storage con URLs firmadas temporales.
- **Diseño "liquid"**: fondo animado, glassmorphism y tipografía moderna (Space Grotesk + Inter).

---

## Ideas para las próximas versiones

- Avisos por email antes de cada renovación (Supabase cron / Edge Functions).
- Reportes: gasto por mes y por categoría con gráficos.
- Exportar a CSV/Excel para conciliar con el resumen de la tarjeta.
- Cotización guardada por fecha (histórico) para reportes en pesos más precisos.
- Roles (admin vs. miembro) si hace falta restringir quién borra.
