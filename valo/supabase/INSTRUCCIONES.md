# VALO - EPORTFOLIO en sitio propio (GitHub Pages + Supabase)

Sitio: **https://dsemino83.github.io/DANI/valo/web/**. Se entra con correo y contraseña; los datos (clientes,
secuencias, historial, bancos, configuración de Cartera) se comparten entre todos y las descargas son directas.

## 1. Crear el proyecto (una sola vez)

1. Entrar a https://supabase.com → **Start your project** → crear la cuenta (puede ser con GitHub).
2. **New project**: nombre `VALO-EPORTFOLIO`, una contraseña de base de datos (guardarla), región **South America (São Paulo)**, plan **Free**.
3. Cuando termine de crearse: menú **SQL Editor** → **New query** → pegar todo el contenido de `esquema.sql` → **Run**.
   Tiene que decir *Success*. (Se puede volver a ejecutar sin problema.)

## 2. Usuarios

1. **Authentication → Sign In / Providers** (o *Auth settings*): desactivar **Allow new users to sign up**
   (así nadie se registra solo). Dejar activo el proveedor **Email**.
2. **Authentication → Users → Add user → Create new user**: correo, contraseña inicial y tildar **Auto Confirm User**.
   Repetir por cada persona. Cada uno puede cambiar su contraseña desde el botón *Cambiar contraseña* del sitio.
3. Entran los correos **@valo.ar** y los que estén en la tabla `permitidos` (ya incluye `d.semino83@gmail.com`).
   Para sumar otro correo externo: **Table Editor → permitidos → Insert row**.
4. Si alguien se olvida la contraseña: **Authentication → Users → (el usuario) → Reset password** o borrarlo y crearlo de nuevo.

## 3. Conectar el sitio

En **Project Settings → API** (o *API Keys*) copiar:
- **Project URL** (`https://xxxx.supabase.co`)
- la clave pública **anon** / **publishable** (no la *service_role* / *secret*: esa nunca se comparte).

Con esos dos datos se completa `valo/supabase-config.js`, se ejecuta `python3 construir.py` y se publica.

## 4. Pasar los datos de claude.ai

Entrar al sitio con tu usuario → botón **Importar datos** → elegir `migracion-valo.json`
(clientes con sus secuencias, historial con sus CSV, Bancos, Bancos MELI y configuración de Cartera).

## A tener en cuenta

- Plan gratuito: si el proyecto pasa **7 días sin uso**, Supabase lo pausa; se reactiva desde el panel (**Restore project**)
  y no se pierden datos.
- La clave pública del sitio puede estar a la vista: lo que protege los datos son los permisos de `esquema.sql`
  (solo usuarios con sesión y correo habilitado leen o escriben).
- Los lotes migrados muestran como autor a un usuario de claude.ai que el sitio no conoce (sale sin nombre).
