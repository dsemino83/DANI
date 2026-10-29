// SO · automatizaciones programadas (Supabase Edge Function). La invoca pg_cron (vía pg_net) cada 5 minutos solo si
// hay turnos vencidos. Autorización: token en el encabezado x-so-cron, comparado dentro de la base con el secreto de
// Vault (el token nunca sale de la base ni se escribe en el código). Ejecuta con service role, pero cada consulta y la
// ruta de Storage se fijan al dueño de la automatización (ver so/archivos/programadas.js).
// Los módulos de SO se importan con el prefijo "so/" (deno.json): el mismo código que exporta desde el navegador.
import { createClient } from "npm:@supabase/supabase-js@2";
import ExcelJS from "npm:exceljs@4.4.0";
import { jsPDF } from "npm:jspdf@2.5.1";
import { applyPlugin } from "npm:jspdf-autotable@3.8.2";
import * as XLSX from "npm:xlsx@0.18.5";
import { ejecutarProgramada, proximaEjecucion, autoprueba } from "so/archivos/programadas.js";

applyPlugin(jsPDF);
const LIBS = { ExcelJS, jsPDF, XLSX };   // XLSX: validar las filas del Excel generado
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "método no permitido" });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const token = req.headers.get("x-so-cron") || "";
  const { data: valido, error: errToken } = await db.rpc("so_cron_token_valido", { p_token: token });
  if (errToken || valido !== true) return json(401, { error: "no autorizado" });

  // Autoprueba (solo con token válido): genera cada formato del servidor con un documento fijo y devuelve huellas y
  // validaciones, para comparar lo desplegado con el código del repositorio. No toca datos.
  const cuerpo = await req.json().catch(() => ({}));
  if (cuerpo?.autoprueba) return json(200, await autoprueba(LIBS));

  const { data: turnos, error } = await db.rpc("so_reclamar_automatizaciones", { p_limite: 10 });
  if (error) return json(500, { error: "no pude leer las automatizaciones pendientes" });
  const resultados = [];
  for (const auto of turnos || []) {
    const slot = new Date(auto.next_run_at).toISOString();
    let r: { estado: string; error?: string; archivos?: unknown[] };
    try { r = await ejecutarProgramada({ db, auto, slot, libs: LIBS }); }
    catch (e) { r = { estado: "fallo", error: e instanceof Error ? e.message : String(e) }; }
    // La próxima se calcula desde ahora (no desde el turno): si el servidor estuvo caído, no se recuperan turnos viejos en ráfaga.
    const proxima = auto.schedule ? proximaEjecucion(auto.schedule, new Date()) : null;
    await db.rpc("so_cerrar_turno", { p_id: auto.id, p_proxima: proxima?.toISOString() ?? null, p_estado: r.estado === "fallo" ? "failed" : "ok", p_error: r.error ?? null });
    resultados.push({ automatizacion: auto.id, estado: r.estado, archivos: r.archivos?.length ?? 0 });   // sin datos del usuario en la respuesta
  }
  return json(200, { procesadas: resultados.length, resultados });
});
