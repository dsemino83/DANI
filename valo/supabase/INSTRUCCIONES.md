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

## 5. Envío a la API NO COBIS en un paso

Cartera → **Enviar a la API** → se descarga `Enviar-NOCOBIS-<fecha>.cmd` → **doble clic** con la PC conectada a la red de
VALO o a la VPN. El archivo trae el lote, hace el login, ingresa las operaciones, muestra el resultado y lo deja en la
página. La primera vez pide el client_secret de la API y lo guarda cifrado en `%APPDATA%\VALO`. No ingresa dos veces el
mismo envío; si no llega a la API (sin VPN), el envío queda pendiente y se puede volver a abrir el mismo archivo.
Requisito: volver a ejecutar `esquema.sql` (función `tomar_envio`). El archivo vale una hora (después: *Descargar de nuevo*).

## 6. Opcional: envío automático con un agente en la red

La página (Cartera → **Enviar a la API**) deja el lote **pendiente** en la base; un agente instalado en una PC de la red
de VALO lo toma, se loguea en la API, ingresa las operaciones y deja el resultado en la página (se ve solo).

1. **SQL**: volver a ejecutar `esquema.sql` en el SQL Editor (agrega la función `tomar_envio`; se puede re-ejecutar).
2. **Usuario del agente**: Authentication → Users → Add user → `robot@valo.ar` (o el que prefieran) con contraseña y
   **Auto Confirm User**. Si no es @valo.ar, agregarlo en la tabla `permitidos`.
3. **En la PC de la red** (prendida, con acceso a la API interna y a internet):
   - Descargar el agente desde la página (Cartera → Envío a la API → *Instalar el agente*) en, por ejemplo, `C:\VALO\Agente`.
   - Ejecutar una vez `powershell -ExecutionPolicy Bypass -File nocobis-agente.ps1 -Configurar` (pide usuario y contraseña
     del agente y el client_secret de la API; tiene que terminar en *OK*).
   - Programarlo cada 5 minutos con el comando `schtasks` que muestra la página (en cmd, con el mismo usuario de Windows).
4. La página muestra **Agente activo** (última conexión) y el estado de cada envío: Pendiente → Procesando → Terminado/Error,
   con el número de operación o el error de cada banco.

Se puede instalar el agente en más de una PC: cada envío lo toma una sola. Si ninguna está prendida, los envíos quedan
pendientes y salen cuando vuelva alguna (o ejecutando el agente a mano). Registro: `agente.log` en la carpeta del agente.

## 7. Tipo de cambio automático (inventarios de garantías)

Más ▾ → Inventario busca solo el tipo de cambio Com. A 3500 del último día hábil del mes del inventario en la API del
BCRA. Si el BCRA no deja que la página lo consulte directo, lo hace la base con la función `tc_bcra`: volver a ejecutar
`esquema.sql` en el SQL Editor (habilita la extensión `http` y agrega la función; se puede re-ejecutar).

## 8. Base de entes (CUIT) de los inventarios

Volver a ejecutar `esquema.sql` (crea la tabla `entes`). Después, en Más ▾ → Inventario → *Entes, CUIT y fechas* →
**Subir base de entes (Excel)** con las planillas de personas jurídicas y humanas.

## 9. Complif (poderes para el bastanteo)

La página baja de Complif los poderes ("Poder", "Poder Complejo") y las actas de designación de autoridades de la
empresa y los compara con el resumen (Excel). Supabase hace de intermediario: la clave de Complif nunca llega al
navegador ni al repositorio.

1. En Supabase → **SQL Editor**, correr el bloque *Complif* del final de `esquema.sql` (necesita la extensión
   `http`, la misma del tipo de cambio).
2. En la página: **Más ▾ → Bastanteo → Conexión con Complif**: URL `https://api.valo.complif.com` (producción;
   homologación es `https://api-uat.complif.com`), *client id* y *client secret*. **Guardar** y **Probar**.
   El secret queda en la tabla `complif_config`, que la página no puede leer (solo se ve si hay uno cargado).
3. Si **Probar** da `invalid_grant`, revisar primero la URL (con `api.complif.com` las credenciales buenas dan ese error).
4. Si da *canceling statement due to statement timeout*, subir el límite de las consultas de la página:
   `alter role authenticated set statement_timeout = '60s'; notify pgrst, 'reload config';`
