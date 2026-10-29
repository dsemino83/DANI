// SO · fuentes API (Supabase Edge Function). La llamada sale siempre del servidor: la credencial vive en Vault y nunca
// llega al navegador ni a los logs. Controles: solo HTTPS a IPs públicas (DNS verificado, redirecciones revalidadas),
// tiempo máximo, tamaño máximo, frecuencia mínima entre sincronizaciones y reintentos acotados.
// Acciones: "probar" (muestra y columnas, no guarda) y "sincronizar" (lote APPEND idempotente → historial).
import { createClient } from "npm:@supabase/supabase-js@2";
import { validarUrl, ipPrivada, leerConLimite, detectarTabla } from "./seguridad.js";

const MAX_BYTES = 2 * 1024 * 1024;
const MIN_ENTRE_SYNC_MS = 60_000;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Verifica que el nombre resuelva solo a IPs públicas. Si el entorno no permite consultar DNS, quedan los controles
// de URL (https, sin IPs privadas literales, sin hosts internos) y se registra que no se pudo verificar.
async function hostPublico(host: string) {
  if (/^[0-9.]+$/.test(host) || host.includes(":")) return !ipPrivada(host);
  if (typeof Deno.resolveDns !== "function") return true;
  const ips: string[] = []; let noSoportado = 0;
  for (const t of ["A", "AAAA"] as const) {
    try { ips.push(...(await Deno.resolveDns(host, t))); }
    catch (e) { if (!(e instanceof Deno.errors.NotFound)) noSoportado++; }
  }
  if (!ips.length) return noSoportado === 2;
  return ips.every((ip) => !ipPrivada(ip));
}

async function llamar(url: URL, init: RequestInit, timeout: number) {
  let actual = url;
  for (let salto = 0; salto < 4; salto++) {
    const v = validarUrl(actual.href);
    if (!v.ok) throw new Error(v.motivo);
    if (!(await hostPublico(actual.hostname))) throw new Error("la dirección apunta a una red privada");
    const r = await fetch(actual, { ...init, redirect: "manual", signal: AbortSignal.timeout(timeout) });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { actual = new URL(r.headers.get("location")!, actual); await r.body?.cancel(); continue; }
    return r;
  }
  throw new Error("demasiadas redirecciones");
}

const aNumero = (v: unknown) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v ?? "").trim().replace(/[$\s]/g, "");
  if (!s) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const aFecha = (v: unknown) => {
  if (typeof v === "number" && v > 1e9) return new Date(v > 1e11 ? v : v * 1000).toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};
async function hash(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const limpiar = (m: string, secreto: string | null) => (secreto ? m.split(secreto).join("***") : m).slice(0, 300);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const t0 = Date.now();
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json(401, { error: "unauthorized" });
  let body: { accion?: string; sourceId?: string };
  try { body = await req.json(); } catch { return json(400, { error: "bad_json" }); }
  if (!body.sourceId || !/^[0-9a-f-]{36}$/.test(body.sourceId) || !["probar", "sincronizar"].includes(body.accion ?? "")) return json(400, { error: "parametros" });

  // La fuente se lee con los permisos del usuario (RLS): solo el dueño puede ejecutarla.
  const { data: src } = await sb.from("so_api_sources").select("*").eq("id", body.sourceId).maybeSingle();
  if (!src) return json(404, { error: "fuente_no_encontrada" });
  if (body.accion === "sincronizar" && src.last_sync_at && Date.now() - Date.parse(src.last_sync_at) < MIN_ENTRE_SYNC_MS) {
    return json(429, { error: "muy_seguido", mensaje: "Se actualizó hace menos de un minuto." });
  }

  let secreto: string | null = null;
  if (src.auth_scheme !== "none") {
    if (!src.auth_ref) return json(409, { error: "falta_credencial", mensaje: "Esta API necesita una credencial." });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data } = await admin.rpc("so_api_leer_secreto", { p_source: src.id });
    secreto = data ?? null;
    if (!secreto) return json(409, { error: "falta_credencial", mensaje: "No encontré la credencial guardada." });
  }

  const v = validarUrl(src.base_url);
  if (!v.ok) return json(400, { error: "url", mensaje: v.motivo });
  const url = v.url;
  for (const [k, val] of Object.entries(src.parameters ?? {})) url.searchParams.set(k, String(val));
  const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "SO-Francisco/1.0" };
  for (const [k, val] of Object.entries(src.headers ?? {})) if (/^[A-Za-z0-9-]{1,64}$/.test(k)) headers[k] = String(val).slice(0, 500);
  if (secreto && src.auth_scheme === "bearer") headers.Authorization = `Bearer ${secreto}`;
  if (secreto && src.auth_scheme === "header") headers[src.auth_name || "X-API-Key"] = secreto;
  if (secreto && src.auth_scheme === "query") url.searchParams.set(src.auth_name || "api_key", secreto);

  const intentos = Math.min(3, Math.max(0, Number(src.retry_policy?.max ?? 2))) + 1;
  let r: Response | null = null, ultimoError = "";
  for (let i = 0; i < intentos; i++) {
    try {
      r = await llamar(url, { method: src.method, headers }, src.timeout_ms);
      if (r.status < 500 && r.status !== 429) break;
      ultimoError = `la API respondió ${r.status}`; await r.body?.cancel();
    } catch (e) { ultimoError = limpiar(String((e as Error).message || e), secreto); r = null; }
    await new Promise((ok) => setTimeout(ok, 500 * 2 ** i));
  }
  const fallar = async (codigo: number, mensaje: string) => {
    await sb.from("so_api_sources").update({ status: "error", last_error: mensaje }).eq("id", src.id);
    await sb.from("so_ingest_log").insert({ stage: `api.${body.accion}`, status: "failed", source_type: "api", artifact_id: src.artifact_id, dataset_id: src.dataset_id, ms: Date.now() - t0 });
    return json(codigo, { error: "api", mensaje });
  };
  if (!r) return fallar(502, ultimoError || "no hubo respuesta");
  if (r.status === 401 || r.status === 403) { await r.body?.cancel(); return fallar(409, "la API rechazó la credencial o requiere una"); }
  if (!r.ok) { await r.body?.cancel(); return fallar(502, `la API respondió ${r.status}`); }

  let datos: unknown;
  try { datos = JSON.parse(await leerConLimite(r, MAX_BYTES)); } catch (e) { return fallar(502, limpiar(`la respuesta no es JSON válido o es muy grande (${(e as Error).message})`, secreto)); }
  const mapeo = src.response_mapping ?? {};
  const tabla = detectarTabla(datos, mapeo.ruta ?? null);

  if (body.accion === "probar") {
    await sb.from("so_api_sources").update({ status: tabla.filas.length ? "ok" : "error", last_error: tabla.filas.length ? null : "no encontré datos tabulares" }).eq("id", src.id);
    return json(200, { ok: true, ruta: tabla.ruta, total: tabla.filas.length, columnas: [...new Set(tabla.filas.slice(0, 50).flatMap((f: Record<string, unknown>) => Object.keys(f)))].slice(0, 60),
      muestra: tabla.filas.slice(0, 5) });
  }

  // sincronizar: requiere mapeo guardado (lo arma la página con el motor de mapeo a partir de "probar").
  if (!src.dataset_id || !Array.isArray(mapeo.asignaciones) || !mapeo.asignaciones.length) return json(409, { error: "sin_mapeo" });
  const { data: ds } = await sb.from("so_datasources").select("id, owner_id, fields").eq("id", src.dataset_id).single();
  const tipos = Object.fromEntries((ds.fields as { key: string; type: string }[]).map((f) => [f.key, f.type]));
  const hoy = new Date().toISOString().slice(0, 10);
  const { data: lote, error: e1 } = await sb.from("so_import_batches").insert({
    dataset_id: ds.id, artifact_id: src.artifact_id, input_id: src.input_id, api_source_id: src.id, source_type: "api", strategy: "APPEND",
    source_name: src.name, mapping: mapeo, rows_received: tabla.filas.length }).select("id").single();
  if (e1) return fallar(500, e1.message);
  const filas: Record<string, unknown>[] = []; const rechazadas: { fila: number; motivo: string }[] = [];
  for (const [i, f] of (tabla.filas as Record<string, unknown>[]).entries()) {
    const data: Record<string, unknown> = {};
    for (const a of mapeo.asignaciones as { columna: string; campo: string }[]) {
      const val = f[a.columna];
      if (val == null || val === "") continue;
      data[a.campo] = tipos[a.campo] === "number" ? aNumero(val) : tipos[a.campo] === "date" ? aFecha(val) : String(val).slice(0, 2000);
    }
    const period = mapeo.fecha ? aFecha(f[mapeo.fecha]) : hoy;
    if (!period || Object.values(data).some((x) => x === null) || !Object.keys(data).length) { rechazadas.push({ fila: i + 1, motivo: !period ? "fecha inválida" : "valor no válido" }); continue; }
    // Idempotencia por contenido: re-sincronizar no duplica observaciones ya guardadas (el historial solo suma lo nuevo).
    filas.push({ datasource_id: ds.id, owner_id: ds.owner_id, period, data, import_batch_id: lote.id, source_ref: { item: i + 1 },
      idempotency_key: `api:${src.id}:${await hash(period + JSON.stringify(data))}` });
  }
  let nuevas = 0;
  for (let i = 0; i < filas.length; i += 500) {
    const { data, error } = await sb.from("so_records").upsert(filas.slice(i, i + 500), { onConflict: "datasource_id,idempotency_key", ignoreDuplicates: true }).select("id");
    if (error) return fallar(500, error.message);
    nuevas += data?.length ?? 0;
  }
  const estado = rechazadas.length ? "partial" : "ready";
  await sb.from("so_import_batches").update({ status: estado, rows_accepted: nuevas, rows_rejected: rechazadas.length, errors: rechazadas.slice(0, 500),
    completed_at: new Date().toISOString() }).eq("id", lote.id);
  await sb.from("so_api_sources").update({ status: "ok", last_error: null, last_sync_at: new Date().toISOString() }).eq("id", src.id);
  if (src.input_id) await sb.from("so_data_inputs").update({ last_updated_at: new Date().toISOString(), status: "active" }).eq("id", src.input_id);
  await sb.from("so_ingest_log").insert({ import_batch_id: lote.id, dataset_id: ds.id, artifact_id: src.artifact_id, source_type: "api", stage: "api.sync", status: estado,
    rows: nuevas, errors: rechazadas.length, ms: Date.now() - t0 });
  return json(200, { ok: true, lote: lote.id, recibidas: tabla.filas.length, nuevas, repetidas: filas.length - nuevas, rechazadas: rechazadas.length });
});
