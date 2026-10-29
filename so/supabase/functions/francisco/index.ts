// Francisco · conversación (Supabase Edge Function).
// Las operaciones deterministas (crear/modificar/compartir artefactos, cargar datos) las resuelve la página con el
// motor de intención y RLS; esta función solo responde en lenguaje natural. El contexto se compila acá, del lado del
// servidor, con el token del usuario (RLS): nunca se concatena el historial completo.
// Secretos: ANTHROPIC_API_KEY (Edge Function secret). Nunca en el frontend ni en GitHub.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = Deno.env.get("SO_MODEL") ?? "claude-opus-5-5";
const RECIENTES = 12;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const IDENTIDAD: Record<string, string> = {
  work: "Sos Francisco, el asistente de trabajo de SO. Tono científico, profesional, moderno, claro y amigable. " +
    "Respondés en español rioplatense, breve y ejecutivo. El usuario no es técnico: nunca le pidas SQL, Git, APIs ni esquemas. " +
    "No inventes datos, resultados ni capacidades. Si algo no está hecho, decilo.",
  personal: "Sos Francisco en modo Personal: casual, relajado, natural y amigable. Español rioplatense. " +
    "En este modo solo conversás: no publicás dashboards ni herramientas.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const inicio = Date.now();
  const requestId = crypto.randomUUID();
  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json(401, { error: "unauthorized" });

  let body: { chatId?: string; projectId?: string | null; archivos?: string[] };
  try { body = await req.json(); } catch { return json(400, { error: "bad_json" }); }
  if (!body.chatId || !/^[0-9a-f-]{36}$/.test(body.chatId)) return json(400, { error: "chat_id" });

  // ContextCompiler (servidor): identidad + resumen compactado + decisiones + estado activo + mensajes recientes.
  const { data: chat, error: e1 } = await sb.from("so_chats").select("id, mode, summary, compacted_until, project_id")
    .eq("id", body.chatId).maybeSingle();
  if (e1 || !chat) return json(404, { error: "chat_not_found" });
  const [{ data: recientes }, { data: decisiones }, { data: artefactos }] = await Promise.all([
    sb.from("so_messages").select("role, content").eq("chat_id", chat.id).in("role", ["user", "assistant"])
      .order("id", { ascending: false }).limit(RECIENTES),
    chat.project_id
      ? sb.from("so_decisions").select("decision").eq("project_id", chat.project_id).order("id", { ascending: false }).limit(15)
      : Promise.resolve({ data: [] as { decision: string }[] }),
    chat.mode === "work"
      ? sb.from("so_artifacts").select("name, type, version, state").is("deleted_at", null).order("updated_at", { ascending: false }).limit(20)
      : Promise.resolve({ data: [] as { name: string }[] }),
  ]);
  const mensajes = (recientes ?? []).reverse()
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  while (mensajes.length && mensajes[0].role !== "user") mensajes.shift();
  if (!mensajes.length) return json(400, { error: "sin_mensaje" });

  // Archivos: solo fragmentos relevantes (índice del servidor, con referencia de página/hoja) y hasta 3 imágenes.
  const { data: conAdjuntos } = await sb.from("so_messages").select("meta").eq("chat_id", chat.id).not("meta->adjuntos", "is", null)
    .order("id", { ascending: false }).limit(6);
  const ids = [...new Set([...(body.archivos ?? []), ...(conAdjuntos ?? []).flatMap((m) => (m.meta?.adjuntos ?? []).map((a: { fileId: string }) => a.fileId))])]
    .filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 10);
  let fragmentos = "";
  const imagenes: { type: "image"; source: { type: "base64"; media_type: string; data: string } }[] = [];
  if (ids.length) {
    const pregunta = [...mensajes].reverse().find((m) => m.role === "user")?.content ?? "";
    const [{ data: frs }, { data: archivos }] = await Promise.all([
      sb.rpc("so_buscar_fragmentos", { p_files: ids, p_q: pregunta, p_limit: 6 }),
      sb.from("so_files").select("id, original_name, kind, detected_type, storage_path, size").in("id", ids),
    ]);
    const nombre = Object.fromEntries((archivos ?? []).map((f) => [f.id, f.original_name]));
    if (frs?.length) fragmentos = "Fragmentos relevantes de archivos adjuntos (citá la referencia):\n" + frs.map((f: { file_id: string; ref: Record<string, unknown>; content: string }) =>
      `[${nombre[f.file_id] ?? "archivo"}${f.ref?.pagina ? `, página ${f.ref.pagina}` : f.ref?.hoja ? `, hoja ${f.ref.hoja}` : f.ref?.diapositiva ? `, diapositiva ${f.ref.diapositiva}` : ""}]\n${f.content}`).join("\n---\n");
    for (const f of (archivos ?? []).filter((x) => x.kind === "image" && ["png", "jpeg", "gif", "webp"].includes(x.detected_type) && x.size <= 5 * 1024 * 1024).slice(0, 3)) {
      const { data: blob } = await sb.storage.from("so-archivos").download(f.storage_path);
      if (!blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      imagenes.push({ type: "image", source: { type: "base64", media_type: `image/${f.detected_type}`, data: btoa(bin) } });
    }
    if (imagenes.length) {
      const ult = mensajes.length - 1;
      mensajes[ult] = { role: "user", content: [...imagenes, { type: "text", text: mensajes[ult].content as string }] as never };
    }
  }

  const estado = [
    chat.summary && Object.keys(chat.summary).length ? `Resumen compactado: ${JSON.stringify(chat.summary)}` : "",
    decisiones?.length ? `Decisiones: ${decisiones.map((d) => d.decision).join(" | ")}` : "",
    artefactos?.length ? `Artefactos del workspace: ${JSON.stringify(artefactos)}` : "",
    fragmentos,
  ].filter(Boolean).join("\n");

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) {
    await sb.from("so_obs").insert({ request_id: requestId, user_id: u.user.id, project_id: chat.project_id, model: MODEL,
      skills: ["FranciscoContext"], capabilities: ["llm"], latency_ms: Date.now() - inicio, result: "blocked", error: "llm_not_configured" });
    return json(503, { error: "llm_not_configured" });
  }

  const client = new Anthropic({ apiKey: key });
  try {
    const r = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [{ type: "text", text: IDENTIDAD[chat.mode] ?? IDENTIDAD.work, cache_control: { type: "ephemeral" } },
               ...(estado ? [{ type: "text" as const, text: estado }] : [])],
      messages: mensajes,
    } as never) as Anthropic.Beta.BetaMessage;
    const texto = r.stop_reason === "refusal"
      ? "No puedo ayudar con eso."
      : r.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.Beta.BetaTextBlock).text).join("\n").trim();
    const tokens = (r.usage?.input_tokens ?? 0) + (r.usage?.output_tokens ?? 0);
    await sb.from("so_obs").insert({ request_id: requestId, user_id: u.user.id, project_id: chat.project_id, model: r.model,
      skills: ["FranciscoContext"], capabilities: imagenes.length ? ["llm", "vision"] : ["llm"], tokens, latency_ms: Date.now() - inicio, result: r.stop_reason ?? "ok" });
    return json(200, { reply: texto || "…", model: r.model, tokens, requestId });
  } catch (err) {
    const status = err instanceof Anthropic.APIError ? err.status ?? 502 : 502;
    await sb.from("so_obs").insert({ request_id: requestId, user_id: u.user.id, project_id: chat.project_id, model: MODEL,
      skills: ["FranciscoContext"], capabilities: ["llm"], latency_ms: Date.now() - inicio, result: "error",
      error: err instanceof Anthropic.APIError ? `api_${err.status}` : "network" });
    return json(status === 429 ? 429 : 502, { error: "llm_error", requestId });
  }
});
