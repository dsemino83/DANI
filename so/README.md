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

## Verificación

```
npm run test:so                                   # intención, análisis, estado, búsqueda, importación, avatar
npm run test:so:e2e                               # recorridos A–G en Chromium con Supabase simulado
psql … -f so/supabase/tests/seguridad.sql         # sobre una base con la migración (nunca producción)
```

## Para conversar libremente

En Supabase → Edge Functions → Secrets: agregar `ANTHROPIC_API_KEY`. Sin ese secreto, todo lo determinista funciona y
Francisco avisa que la conversación libre no está conectada.
