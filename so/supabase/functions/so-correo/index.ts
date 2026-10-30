// SO · Correo (Supabase Edge Function). Conecta Gmail por OAuth (PKCE + state) con permiso de solo lectura, sincroniza
// los mensajes recientes y desconecta (revoca el permiso y borra los mails). Autorización: la sesión
// del usuario (JWT) para todo salvo la vuelta de Google, que se valida con el state guardado en la base.
// Secretos de la función (los carga el dueño del proyecto en Supabase): GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET.
import { createClient } from "npm:@supabase/supabase-js@2";
import { aleatorio, desafioPkce, urlAutorizacion, canjearCodigo, refrescar, perfil, listarIds, leerMensaje, aFila, revocar, SCOPES } from "so/correo/gmail.js";

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const REDIRECT = `${URL_BASE}/functions/v1/so-correo`;
const ORIGENES = [/^https:\/\/dsemino83\.github\.io(\/|$)/, /^http:\/\/localhost(:\d+)?(\/|$)/];
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const servicio = () => createClient(URL_BASE, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const credenciales = () => ({ clientId: Deno.env.get("GOOGLE_CLIENT_ID") || "", clientSecret: Deno.env.get("GOOGLE_CLIENT_SECRET") || "" });
const volverA = (url: string, params: Record<string, string>) => { const u = new URL(url); u.hash = `#/correo?${new URLSearchParams(params)}`; return Response.redirect(u.href, 302); };

async function tokenDe(db: ReturnType<typeof servicio>, cuenta: { id: string }) {
  const { data: refresh } = await db.rpc("so_correo_leer_token", { p_cuenta: cuenta.id });
  if (!refresh) throw new Error("la casilla no está conectada: volvé a conectarla");
  return (await refrescar(fetch, { refreshToken: refresh, ...credenciales() })).access_token as string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = servicio();
  const u = new URL(req.url);

  // Vuelta de Google: valida el state (una sola vez, 10 minutos), canjea el código y guarda el token en Vault.
  if (req.method === "GET") {
    const state = u.searchParams.get("state") || "";
    const { data: st } = await db.from("so_mail_oauth_state").delete().eq("state", state).select("*").maybeSingle();
    if (!st || Date.now() - Date.parse(st.created_at) > 600_000) return new Response("El enlace de conexión venció. Volvé a SO y conectá la casilla de nuevo.", { status: 400 });
    if (u.searchParams.get("error") || !u.searchParams.get("code")) return volverA(st.volver, { error: u.searchParams.get("error") || "cancelado" });
    try {
      const t = await canjearCodigo(fetch, { code: u.searchParams.get("code")!, verificador: st.verifier, redirectUri: REDIRECT, ...credenciales() });
      if (!t.refresh_token) throw new Error("Google no entregó un permiso duradero");
      const p = await perfil(fetch, t.access_token);
      const { data: c, error } = await db.from("so_mail_accounts").upsert({ owner_id: st.owner_id, provider: "gmail", email: String(p.emailAddress).toLowerCase(), scopes: String(t.scope || "").split(" "), status: "conectada", last_error: null },
        { onConflict: "owner_id,provider,email" }).select("id").single();
      if (error || !c) throw new Error("no pude registrar la casilla");
      const { error: e2 } = await db.rpc("so_correo_guardar_token", { p_cuenta: c.id, p_token: t.refresh_token });
      if (e2) throw new Error("no pude guardar el permiso de forma segura");
      return volverA(st.volver, { ok: "1" });
    } catch (e) { return volverA(st.volver, { error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }); }
  }

  if (req.method !== "POST") return json(405, { error: "método no permitido" });
  const usr = createClient(URL_BASE, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: who } = await usr.auth.getUser();
  if (!who?.user) return json(401, { error: "no autorizado" });
  const { data: habilitado } = await db.rpc("so_usuario_habilitado", { p_user: who.user.id });
  if (!habilitado) return json(403, { error: "usuario no habilitado" });
  const owner = who.user.id;
  const b = await req.json().catch(() => ({}));
  const { clientId, clientSecret } = credenciales();
  if (!clientId || !clientSecret) return json(503, { error: "sin_configurar", mensaje: "Falta configurar la app de Google (GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET) en Supabase." });

  try {
    if (b.accion === "iniciar") {
      const volver = String(b.volver || "");
      if (!ORIGENES.some((r) => r.test(volver))) return json(400, { error: "origen no permitido" });
      const state = aleatorio(32), verifier = aleatorio(48);
      await db.from("so_mail_oauth_state").delete().lt("created_at", new Date(Date.now() - 600_000).toISOString());
      const { error } = await db.from("so_mail_oauth_state").insert({ state, owner_id: owner, verifier, volver });
      if (error) throw new Error("no pude iniciar la conexión");
      return json(200, { url: urlAutorizacion({ clientId, redirectUri: REDIRECT, state, desafio: await desafioPkce(verifier) }), scopes: SCOPES });
    }

    const { data: cuentas } = await db.from("so_mail_accounts").select("id, email, status").eq("owner_id", owner).neq("status", "desconectada");
    const cuenta = (cuentas || []).find((c) => !b.cuenta || c.id === b.cuenta);
    if (!cuenta) return json(404, { error: "sin_cuenta", mensaje: "No tenés una casilla conectada." });

    if (b.accion === "sincronizar") {
      const token = await tokenDe(db, cuenta);
      const ids = await listarIds(fetch, token, { dias: Math.min(90, Math.max(1, Number(b.dias) || 30)), max: 300 });
      const { data: ya } = await db.from("so_mails").select("gmail_id").eq("account_id", cuenta.id).in("gmail_id", ids.length ? ids : ["-"]);
      const nuevos = ids.filter((id) => !(ya || []).some((x) => x.gmail_id === id));
      let guardados = 0;
      for (let i = 0; i < nuevos.length; i += 10) {
        const filas = (await Promise.all(nuevos.slice(i, i + 10).map((id) => leerMensaje(fetch, token, id)))).map((m) => ({ ...aFila(m, cuenta.email), owner_id: owner, account_id: cuenta.id }));
        const { error } = await db.from("so_mails").upsert(filas, { onConflict: "account_id,gmail_id" });
        if (error) throw new Error("no pude guardar los mails");
        guardados += filas.length;
      }
      await db.from("so_mail_accounts").update({ last_sync_at: new Date().toISOString(), status: "conectada", last_error: null }).eq("id", cuenta.id);
      return json(200, { email: cuenta.email, revisados: ids.length, nuevos: guardados });
    }

    if (b.accion === "desconectar") {
      const { data: refresh } = await db.rpc("so_correo_leer_token", { p_cuenta: cuenta.id });
      if (refresh) await revocar(fetch, refresh);
      await db.rpc("so_correo_borrar_token", { p_cuenta: cuenta.id });
      await db.from("so_mails").delete().eq("account_id", cuenta.id);
      await db.from("so_mail_accounts").update({ status: "desconectada" }).eq("id", cuenta.id);
      return json(200, { desconectada: cuenta.email });
    }
    return json(400, { error: "acción desconocida" });
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    if (b.accion === "sincronizar") await db.from("so_mail_accounts").update({ last_error: msg, ...(/volvé a conectar/.test(msg) ? { status: "error" } : {}) }).eq("owner_id", owner).neq("status", "desconectada");
    return json(502, { error: msg });
  }
});
