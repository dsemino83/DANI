// Prueba del ejecutor de automatizaciones programadas en Deno (el runtime de la Edge Function), con las mismas
// librerías npm, contra una base en memoria que imita la API de supabase-js (sin RLS: como el service role).
// Uso: deno test -A so/tests/deno/automatizaciones.test.ts
import ExcelJS from "npm:exceljs@4.4.0";
import { jsPDF } from "npm:jspdf@2.5.1";
import { applyPlugin } from "npm:jspdf-autotable@3.8.2";
import * as XLSX from "npm:xlsx@0.18.5";
import { ejecutarProgramada, proximaEjecucion } from "../../archivos/programadas.js";
import { validarArchivo } from "../../archivos/generar.js";

applyPlugin(jsPDF);
const LIBS = { ExcelJS, jsPDF, XLSX };
const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };

function base(habilitados: string[]) {
  const t: Record<string, any[]> = { so_tasks: [], so_artifacts: [], so_datasources: [], so_records: [], so_files: [], so_notifications: [] };
  const objetos = new Map<string, Uint8Array>();
  const from = (tabla: string) => {
    const st: any = { f: [] as ((r: any) => boolean)[], op: "select", row: null, single: false, rango: null };
    const run = () => {
      if (st.op === "insert") {
        const r = { id: crypto.randomUUID(), ...st.row };
        if (tabla === "so_tasks" && t.so_tasks.some((x) => x.owner_id === r.owner_id && x.idempotency_key === r.idempotency_key)) return { data: null, error: { code: "23505", message: "duplicate key" } };
        t[tabla].push(r); return { data: st.single ? r : [r], error: null };
      }
      let rows = t[tabla].filter((r) => st.f.every((f: any) => f(r)));
      if (st.op === "update") { rows.forEach((r) => Object.assign(r, st.row)); return { data: rows, error: null }; }
      if (st.rango) rows = rows.slice(st.rango[0], st.rango[1] + 1);
      return { data: st.single ? rows[0] ?? null : rows, error: null };
    };
    const b: any = {
      select: () => b, insert: (r: any) => { st.op = "insert"; st.row = r; return b; }, update: (r: any) => { st.op = "update"; st.row = r; return b; },
      eq: (c: string, v: unknown) => { st.f.push((r: any) => r[c] === v); return b; }, is: (c: string, v: unknown) => { st.f.push((r: any) => (r[c] ?? null) === v); return b; },
      order: () => b, range: (a: number, z: number) => { st.rango = [a, z]; return b; }, single: () => { st.single = true; return b; }, maybeSingle: () => { st.single = true; return b; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  const db = {
    from, t, objetos,
    rpc: async (fn: string, a: any) => fn === "so_usuario_habilitado" ? { data: habilitados.includes(a.p_user), error: null } : { data: null, error: { message: "rpc" } },
    storage: { from: () => ({
      upload: async (path: string, bytes: Uint8Array) => { if (objetos.has(path)) return { error: { message: "Duplicate" } }; objetos.set(path, bytes); return { data: { path }, error: null }; },
      download: async (path: string) => objetos.has(path) ? { data: new Blob([objetos.get(path)!]), error: null } : { data: null, error: { message: "404" } },
    }) },
  };
  return db;
}

function semilla(db: any, owner: string, n = 1500) {
  const ds = crypto.randomUUID(), art = crypto.randomUUID();
  db.t.so_datasources.push({ id: ds, owner_id: owner, fields: [{ key: "monto", label: "Monto", type: "number" }, { key: "canal", label: "Canal", type: "text" }] });
  db.t.so_artifacts.push({ id: art, owner_id: owner, project_id: crypto.randomUUID(), name: "Cobranzas", datasource_id: ds, deleted_at: null, configuration: { metrica: "monto" } });
  for (let i = 0; i < n; i++) db.t.so_records.push({ id: i, datasource_id: ds, owner_id: owner, superseded_by: null, period: `2026-${String(7 + (i % 3)).padStart(2, "0")}-10`, data: { monto: 10 + (i % 7), canal: i % 2 ? "web" : "local" } });
  return art;
}

const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b";
const horario = { tipo: "semanal", dias: [1], hora: "09:00", tz: "America/Argentina/Buenos_Aires" };

Deno.test("genera PDF y Excel reales en la carpeta del dueño, verifica la descarga y avisa", async () => {
  const db = base([A]); const art = semilla(db, A);
  const auto = { id: crypto.randomUUID(), owner_id: A, artifact_id: art, name: "Cada lunes", action: { pasos: ["pdf", "xlsx", "avisar"] }, schedule: horario };
  const r = await ejecutarProgramada({ db, auto, slot: "2026-11-02T12:00:00.000Z", libs: LIBS, ahora: new Date("2026-11-02T12:00:30Z") });
  ok(r.estado === "ok" && r.archivos?.length === 2, `estado ${JSON.stringify(r)}`);
  for (const f of db.t.so_files) {
    ok(f.owner_id === A && f.storage_path.startsWith(`${A}/${f.id}/`) && f.status === "ready" && f.origin === "generated", "archivo en la carpeta del dueño y listo");
    const v = validarArchivo(db.objetos.get(f.storage_path)!, f.detected_type, { XLSX, filasEsperadas: f.detected_type === "xlsx" ? 1503 : null });
    ok(v.ok, `${f.detected_type}: ${v.detalle}`);
  }
  ok(db.t.so_tasks[0].status === "completed" && db.t.so_notifications.some((n: any) => n.owner_id === A && n.priority === "success"), "tarea completada y aviso al dueño");
  ok(db.t.so_files.find((f: any) => f.detected_type === "xlsx").meta.descripcion.includes("1500 registros"), "pagina más allá de 1000 registros");
});

Deno.test("idempotente por turno: el mismo horario no genera dos veces", async () => {
  const db = base([A]); const art = semilla(db, A, 10);
  const auto = { id: crypto.randomUUID(), owner_id: A, artifact_id: art, name: "x", action: { pasos: ["csv"] }, schedule: horario };
  await ejecutarProgramada({ db, auto, slot: "s1", libs: LIBS });
  const r2 = await ejecutarProgramada({ db, auto, slot: "s1", libs: LIBS });
  ok(r2.estado === "repetida" && db.t.so_files.length === 1, "segunda ejecución del mismo turno");
});

Deno.test("nunca cruza usuarios: tablero ajeno o usuario deshabilitado fallan sin generar nada", async () => {
  const db = base([A]); const artA = semilla(db, A, 10);
  const ajena = await ejecutarProgramada({ db, auto: { id: "1", owner_id: B, artifact_id: artA, name: "robo", action: { pasos: ["pdf"] }, schedule: horario }, slot: "s", libs: LIBS });
  ok(ajena.estado === "fallo" && db.t.so_files.length === 0, "automatización de B sobre el tablero de A");
  const db2 = base([]); const art2 = semilla(db2, A, 10);
  const r = await ejecutarProgramada({ db: db2, auto: { id: "2", owner_id: A, artifact_id: art2, name: "x", action: { pasos: ["pdf"] }, schedule: horario }, slot: "s", libs: LIBS });
  ok(r.estado === "fallo" && /habilitado/.test(r.error!) && db2.t.so_notifications.some((n: any) => n.priority === "action"), "usuario deshabilitado: falla visible");
});

Deno.test("las imágenes no se generan en el servidor: se informa, no se finge", async () => {
  const db = base([A]); const art = semilla(db, A, 10);
  const r = await ejecutarProgramada({ db, auto: { id: "3", owner_id: A, artifact_id: art, name: "x", action: { pasos: ["png"] }, schedule: horario }, slot: "s", libs: LIBS });
  ok(r.estado === "fallo" && /necesita el navegador/.test(r.error!), r.error!);
});

Deno.test("próxima ejecución en la zona del usuario", () => {
  ok(proximaEjecucion(horario, new Date("2026-10-29T15:00:00Z"))!.toISOString() === "2026-11-02T12:00:00.000Z", "lunes 9:00 en Buenos Aires = 12:00 UTC");
});
