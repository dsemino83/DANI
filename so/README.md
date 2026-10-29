# SO · Francisco

**En internet:** https://dsemino83.github.io/DANI/so/ — chat con Francisco + workspace de tableros. Se entra con el mismo
usuario de Supabase que el sitio `/web/`.

- **Trabajo:** chat + workspace. Cada tablero es un `WorkArtifact` con ruta propia (`#/a/<id>`), entrada en el menú,
  datos históricos en Supabase, versiones (con restaurar) y compartir.
- **Personal:** solo chat; no publica tableros.
- **Compartido:** `/so/shared/<id>` (GitHub Pages lo resuelve con `404.html` → `/so/shared/#<id>`). La persona entra con su
  correo y ve **solo** ese tablero; nunca el chat, la memoria ni otros tableros. Permisos: `VIEW`, `USE` (por defecto), `EDIT`.

## Piezas

| Archivo | Qué hace |
|---|---|
| `intent.js` | FranciscoIntent: entiende pedidos sin LLM (crear, "agregale…", "este dashboard", "el de ventas", compartir, revocar, cargar datos, borrar visualización ≠ borrar datos). Regla determinista de persistencia (histórico, evolución, seguimiento…). |
| `app.js` | Chat, workspace, ejecución de intenciones contra Supabase con la sesión del usuario (RLS). |
| `vista.js` | Render del tablero: KPIs, gráfico (líneas/barras/torta), carga de datos e historial. Lo usa también la vista compartida. |
| `avatar.js` | Francisco: estados `idle → listening → thinking → executing → responding → success/error → idle`, 13 emociones, parpadeo/respiración sutiles, `prefers-reduced-motion`. Renderer local SVG (fallback); acepta un manifiesto de imágenes en caché por emoción. |
| `supabase/migrations/` | Esquema versionado: proyectos, datasources, registros, artefactos, versiones, menú, compartidos, chats, mensajes, decisiones, señales de aprendizaje, tareas, automatizaciones, auditoría, observabilidad; RLS, funciones de compartir y compactación cada 3 h (pg_cron). |
| `supabase/functions/francisco/` | Conversación libre (Edge Function). Compila el contexto mínimo en el servidor; requiere el secreto `ANTHROPIC_API_KEY`. |
| `supabase/migrations/20261029180000_so_ux.sql` | Tareas en segundo plano, notificaciones, continuidad, favoritos/recientes, búsqueda global y métricas. |
| `supabase/tests/seguridad.sql` | Prueba de aislamiento entre usuarios, permisos VIEW/USE/EDIT, revocar, validación de datos, borrar tablero sin borrar datos y compactación idempotente. |

## Experiencia (capa AI-native)

- **Un solo estado** (`estado.js`): período, filtro, comparación, selección y artefacto activo los cambian igual la UI y
  Francisco. Los chips junto al composer muestran ese contexto y se quitan con ×.
- **Riesgo → patrón**: bajo se ejecuta; medio se ejecuta con **Deshacer**; alto (borrar datos, dar permiso para
  modificar) muestra una **vista previa** antes. Nada se informa como hecho sin releerlo (**✓ Verificado**).
- **Resultados persistentes**: tarjetas de artefacto (Abrir · Compartir · Editar con Francisco · Más) en el chat y en el inicio.
- **Inicio del proyecto**: continuar, recientes, pendientes, actividad relevante y compartidos. Primera vez: qué es
  Francisco y ejemplos accionables que desaparecen cuando dejan de servir.
- **Tareas largas** (importar CSV por lotes idempotentes) y **avisos** viven en el centro 🔔, no en la conversación.
- **⌘K / Ctrl+K**: búsqueda difusa (relevancia + recencia + frecuencia) de tableros, proyectos, conversaciones y
  registros (`so_buscar`, con los permisos del usuario) y acciones.
- **Recuperación**: Reintentar en chat y en tableros; "Seguir usando los últimos datos" con aviso de que son de caché.
- **Continuidad**: proyecto, tablero y filtros se retoman en cualquier dispositivo (`so_user_state`); lo efímero no.
- **Métricas** (`so_events`): tiempo al primer valor, tiempo a resultado, tareas completadas/fallidas, reintentos,
  recuperaciones, reuso, búsquedas, compartidos, deshacer y vistas previas confirmadas/canceladas.

## Entrada universal (archivos, imágenes y APIs)

Recorrido común: `recibir → identificar (firma de bytes) → validar → seguridad → guardar (Storage privado) → extraer
(Web Worker aislado) → normalizar → indexar → asociar`. Módulos en `ingesta/`:

| Archivo | Qué hace |
|---|---|
| `tipos.js` | Tipo real por contenido (no por extensión), avisa si el nombre miente, bloquea ejecutables/scripts, sanea nombres, límites y detección de credenciales pegadas en el chat. |
| `lector-worker.js` | Lee PDF (pdf.js sin eval), XLSX/XLS/ODS (SheetJS, solo valores; macros nunca se ejecutan), DOCX/PPTX/ODT/ODP, CSV/TSV por partes, JSON, XML (sin DTD/entidades), TXT/MD/RTF. |
| `entrada.js` | UniversalInputService: subida con progreso, cancelación y reintento por etapa (sin volver a subir), metadatos en `so_files`, fragmentos en `so_file_chunks`. |
| `perfil.js` / `mapeo.js` | Perfil de datos (encabezados, tipos, nulos, duplicados, claves, formatos) y DataMappingEngine (sinónimos, ambigüedad → una sola pregunta, estrategia según intención). |
| `importador.js` | ImportBatch: APPEND/UPSERT/REPLACE/TEMPORARY (reemplazar marca, no borra), filas inválidas a revisión, duplicados por checksum, reanudación con el mismo lote. |
| `intencion.js` | "Analizá este archivo", "Creá un dashboard con estos datos", "Sumá esto a Ventas", "Compará con el anterior", "Conectá esta API", "¿De dónde salió este dato?", "el Excel que subí la semana pasada". |
| `../datos.js` | Adjuntos del chat (+, arrastrar, pegar, cámara), vista previa, panel "Datos y fuentes", vista previa de importación con mapeo editable, alta de APIs con credencial en Vault. |
| `../supabase/functions/so-api/` | Llamadas a APIs desde el servidor: anti-SSRF, redirecciones revalidadas, tiempo y tamaño máximos, reintentos, historial idempotente. |
| `../workspace.js` · `../comando.js` · `../genui.js` · `../iconos.js` | Workspace adaptativo (Living Cards con vista previa en caché, Bento S/M/L), CommandRouter de ⌘K, UI generativa validada por registro, íconos únicos. |
| `../archivos/` | Archivos generados (XLSX, CSV, JSON, XML, PDF, DOCX, PPTX, RTF, TXT, MD, PNG, JPG, WEBP) validados antes de guardarse, descarga por URL firmada, versiones que nunca sobrescriben, comparación, consolidación, plantillas, automatizaciones al importar, colecciones y paquetes ZIP ("descargar todo"). |
| `../supabase/migrations/20261030120000_so_workspace.sql` | Vista previa y tamaño de tarjetas, origen y resumen de cambio de archivos, plantillas de archivos. |
| `../supabase/migrations/20261030140000_so_archivos_formatos.sql` | Formatos nuevos en plantillas y métricas `download` / `pin_to_workspace` permitidas. |
| `../supabase/migrations/20261029220000_so_ingesta.sql` | Bucket privado y políticas por carpeta, archivos, fragmentos, DatasetRegistry, entradas de datos, lotes y linaje, fuentes API con secretos en Vault, carga compartida solo si el dueño la habilita, retención. |

## Verificación

```
npm run test:so                                   # intención, análisis, estado, búsqueda, importación, avatar
npm run test:so:e2e                               # recorridos A–G en Chromium con Supabase simulado
npm run test:so:ingesta                           # recorridos de ingesta A–K (archivos reales generados, Storage simulado)
npm run test:so:deno                              # ejecutor de automatizaciones programadas en Deno (runtime de la Edge Function)
npm run test:so:workspace                         # Workspace adaptativo + archivos: descargas reales validadas (XLSX/PDF/DOCX/PPTX), versiones, seguridad, móvil, a11y
psql … -f so/supabase/tests/supabase_local.sql    # solo en un PostgreSQL local: simula auth, storage, vault, cron y net
psql … -f so/supabase/tests/seguridad.sql         # sobre una base con las migraciones (nunca producción)
```

## Automatizaciones programadas ("cada lunes a las 9 generá el PDF de ventas")

Corren en el servidor aunque SO esté cerrado: pg_cron (cada 5 min) → `so_disparar_automatizaciones()` → si hay turnos
vencidos, pg_net llama a la Edge Function `so-automatizaciones` con un token que vive solo en Vault → la función reclama
los turnos (lease atómico), genera el archivo con el mismo código que el navegador (`archivos/programadas.js`), lo guarda
en la carpeta del dueño, verifica la descarga y avisa. Horarios diarios, semanales o mensuales en la zona del usuario.
Las imágenes (PNG/JPG/WEBP) no se programan: se dibujan con el Canvas del navegador.

Configuración única (ya hecha en el proyecto; para otro proyecto, en el editor SQL):
`vault.create_secret('https://<ref>.supabase.co', 'so_functions_url')` y
`vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'so_cron_token')` (el token no sale de la base).

Despliegue de la función: `index.ts` importa los módulos con el prefijo `so/`. En el repositorio `deno.json` lo apunta a
`../../../` (pruebas locales); al desplegar, el `deno.json` apunta a
`https://raw.githubusercontent.com/dsemino83/DANI/<commit>/so/` fijado a un commit (inmutable: lo desplegado es exactamente
ese código). Autoprueba: `select public.so_disparar_automatizaciones(true)` no ejecuta nada si no hay turnos; con
`{"autoprueba": true}` y el token, la función devuelve las huellas de cada formato para compararlas con el repositorio.

## Para conversar libremente

En Supabase → Edge Functions → Secrets: agregar `ANTHROPIC_API_KEY`. Sin ese secreto, todo lo determinista funciona y
Francisco avisa que la conversación libre no está conectada.
