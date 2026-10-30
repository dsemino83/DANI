// SO · Encargos a Claude (Supabase Edge Function). Francisco deriva pedidos que necesitan los conectores de la cuenta de
// Claude del usuario a su tarea programada de Claude Code (disparador por API) y recibe el resultado. Todo por detrás.
// - Con sesión del usuario (JWT): vincular / desvincular / estado / crear (dispara la tarea).
// - Sin sesión, con la clave de un solo uso del encargo: GET (la tarea lee el pedido) y POST entregar / fallar.
// La clave del disparador vive en Vault; el dueño se fija en cada consulta (service role).
import { createClient } from "npm:@supabase/supabase-js@2";
import { accionUsuario, leerEncargo, entregarEncargo } from "so/encargos/servidor.js";

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const servicio = () => createClient(URL_BASE, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const ok = <T>(r: { data: T; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data; };
function repo(db: ReturnType<typeof servicio>) {
  return {
    async vinculo(o: string) { const d = ok(await db.rpc("so_claude_leer", { p_owner: o })) as { url: string; token: string }[]; return d?.[0] ?? null; },
    async guardarVinculo(o: string, url: string, token: string) { ok(await db.rpc("so_claude_guardar", { p_owner: o, p_url: url, p_token: token })); },
    async borrarVinculo(o: string) { ok(await db.rpc("so_claude_borrar", { p_owner: o })); },
    async marcarVinculo(o: string, p: Record<string, unknown>) { await db.from("so_claude_vinculos").update(p).eq("owner_id", o); },
    async enCurso(o: string) { const { count } = await db.from("so_encargos").select("id", { count: "exact", head: true }).eq("owner_id", o).in("estado", ["pendiente", "enviado", "en_curso"]); return count ?? 0; },
    async vencer(o: string, antes: string) { await db.from("so_encargos").update({ estado: "fallo", error: "venció sin respuesta de Claude", token_hash: null }).eq("owner_id", o).in("estado", ["pendiente", "enviado", "en_curso"]).lt("created_at", antes); },
    async crear(f: Record<string, unknown>) { return ok(await db.from("so_encargos").insert(f).select("*").single()); },
    async encargo(id: string) { return ok(await db.from("so_encargos").select("*").eq("id", id).maybeSingle()); },
    async actualizar(id: string, p: Record<string, unknown>, { estados }: { estados: string[] }) { return ok(await db.from("so_encargos").update(p).eq("id", id).in("estado", estados).select("id").maybeSingle()); },
    async mensaje(m: { owner_id: string; chat_id: string; content: string; meta: unknown }) {
      // Solo en una conversación del mismo dueño.
      const { data: c } = await db.from("so_chats").select("id").eq("id", m.chat_id).eq("owner_id", m.owner_id).maybeSingle();
      if (!c) return;
      ok(await db.from("so_messages").insert({ ...m, role: "assistant" }));
      await db.from("so_chats").update({ updated_at: new Date().toISOString() }).eq("id", m.chat_id);
    },
    async aviso(a: Record<string, unknown>) { await db.from("so_notifications").insert(a); },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = servicio();
  try {
    // La tarea de Claude lee el encargo.
    if (req.method === "GET") {
      const u = new URL(req.url);
      const r = await leerEncargo(repo(db), { encargo: u.searchParams.get("encargo"), token: u.searchParams.get("token") });
      return json(r.status, r.body);
    }
    if (req.method !== "POST") return json(405, { error: "método no permitido" });
    const b = await req.json().catch(() => ({}));
    // La tarea de Claude entrega (autoriza la clave del encargo, no una sesión).
    if (b.accion === "entregar" || b.accion === "fallar") { const r = await entregarEncargo(repo(db), { body: b }); return json(r.status, r.body); }

    const usr = createClient(URL_BASE, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: who } = await usr.auth.getUser();
    if (!who?.user) return json(401, { error: "no autorizado" });
    const { data: habilitado } = await db.rpc("so_usuario_habilitado", { p_user: who.user.id });
    if (!habilitado) return json(403, { error: "usuario no habilitado" });
    const r = await accionUsuario(repo(db), { owner: who.user.id, body: b, fetch });
    return json(r.status, r.body);
  } catch (e) {
    return json(500, { error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
  }
});
