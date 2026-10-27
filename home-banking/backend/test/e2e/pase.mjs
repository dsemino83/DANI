// Pase mensual a la base histórica y cadena de hashes de la auditoría, contra SQL Server real.
// Carga datos viejos como sa (fechas atrasadas), corre el pase con los logins del pase y controla que lo terminado
// se mueva completo y verificado, que lo abierto se quede y que la cadena de la auditoría siga íntegra.
import sql from 'mssql';

const env = process.env;
const sa = new sql.ConnectionPool({ server: env.MSSQL_HOST, port: Number(env.MSSQL_PORT), user: 'sa', password: env.MSSQL_SA_PASSWORD, database: 'homebanking',
  options: { encrypt: true, trustServerCertificate: true } });
await sa.connect();
const q = async (texto, base = sa) => (await base.request().query(texto)).recordset ?? [];

let fallas = 0;
const ok = (c, m, x = '') => { if (!c) fallas++; console.log(c ? 'OK  ' : 'FAIL', m, c ? '' : JSON.stringify(x).slice(0, 300)); };

const op = (n, estado, creado) => `INSERT INTO transferencia (tipo, api, cuenta_origen, moneda, destino, importe, request, creador, estado, referencia, creado_en)
  VALUES (N'INMEDIATA', N'x', N'300100000000000', N'ARS', N'0000000000000000000001', ${n}.50, N'{}', N'ana', N'${estado}', N'REF${n}${estado.slice(0, 3)}', '${creado}')`;
// mayo: dos terminadas; abril: una abierta (el mes no pasa); octubre: reciente (no pasa)
await q(`${op(1, 'DEBITADA', '2026-05-10T12:00:00Z')}; ${op(2, 'ERROR_API', '2026-05-20T12:00:00Z')}; ${op(3, 'PENDIENTE_APROBACION', '2026-04-15T12:00:00Z')}; ${op(4, 'DEBITADA', '2026-10-20T12:00:00Z')}`);
const ids = Object.fromEntries((await q('SELECT id, referencia FROM transferencia')).map((r) => [r.referencia, r.id]));
for (const [ref, en] of [['REF1DEB', '2026-05-10T12:00:00Z'], ['REF2ERR', '2026-05-20T12:00:00Z'], ['REF3PEN', '2026-04-15T12:00:00Z'], ['REF4DEB', '2026-10-20T12:00:00Z']]) {
  await q(`INSERT INTO transferencia_estado (transferencia_id, estado, usuario, en) VALUES (${ids[ref]}, N'X', N'ana', '${en}')`);
}
for (const en of ['2026-05-02T10:00:00Z', '2026-05-03T10:00:00Z', '2026-05-04T10:00:00Z', '2026-10-21T10:00:00Z', '2026-10-22T10:00:00Z']) {
  await q(`INSERT INTO auditoria (usuario, rol, tipo, accion, detalle, resultado, en) VALUES (N'ana', N'Crear', N'Consultas', N'Prueba', N'á|ñ ${en}', N'OK', '${en}')`);
}

const { verificarAuditoria } = await import('../../src/servicios/integridad.js');
const antes = await verificarAuditoria();
ok(antes.ok && antes.filas === 5, 'cadena íntegra antes del pase (5 registros)', antes);

env.DB_PASE_USER = 'hb_pase'; env.DB_PASE_PASSWORD = env.HB_PASE_PASS;
env.DBH_PASE_USER = 'hb_pase_h'; env.DBH_PASE_PASSWORD = env.HB_PASE_H_PASS;
const { ejecutarPase } = await import('../../src/jobs/pase-historico.js');
const r = await ejecutarPase({ warn() {}, error: console.error });
const de = (tabla, periodo) => r.find((x) => x.tabla === tabla && x.periodo === periodo);
ok(de('transferencia', '2026-05-01')?.estado === 'OK' && de('transferencia', '2026-05-01').filas === 2, 'transferencias de mayo (terminadas) pasan', r);
ok(de('transferencia', '2026-04-01')?.estado === 'OMITIDO', 'abril tiene una abierta: se omite', r);
ok(de('transferencia_estado', '2026-05-01')?.estado === 'OK' && de('auditoria', '2026-05-01')?.estado === 'OK', 'estados y auditoría de mayo pasan', r);
ok(!r.some((x) => x.estado === 'ERROR'), 'ningún mes con error', r);

const quedan = await q('SELECT referencia FROM transferencia ORDER BY id');
ok(quedan.map((x) => x.referencia).join() === 'REF3PEN,REF4DEB', 'en la operativa quedan la abierta y la reciente', quedan);
const hist = new sql.ConnectionPool({ server: env.MSSQL_HOST, port: Number(env.MSSQL_PORT), user: 'sa', password: env.MSSQL_SA_PASSWORD, database: 'homebanking_hist', options: { encrypt: true, trustServerCertificate: true } });
await hist.connect();
const enHist = await q('SELECT referencia, importe FROM transferencia ORDER BY id', hist);
ok(enHist.map((x) => x.referencia).join() === 'REF1DEB,REF2ERR' && Number(enHist[0].importe) === 1.5, 'la histórica recibe las dos con el importe exacto', enHist);
const rec = await q('SELECT tabla, periodo, filas FROM pase_recibido ORDER BY tabla', hist);
ok(rec.length === 3 && rec.every((x) => x.filas > 0), 'comprobante de recepción por tabla', rec);
const reg = await q(`SELECT estado, COUNT(*) AS n FROM pase_historico GROUP BY estado ORDER BY estado`);
ok(reg.find((x) => x.estado === 'OK')?.n === 3 && reg.find((x) => x.estado === 'OMITIDO')?.n === 1, 'el pase registra OK y OMITIDO', reg);
const hAud = await q(`SELECT COUNT(*) AS n FROM auditoria WHERE detalle LIKE N'á|ñ%'`, hist);
ok(hAud[0].n === 3, 'la auditoría de mayo conserva los acentos en la histórica', hAud);

const despues = await verificarAuditoria();
ok(despues.ok && despues.empalmeHistorica === true && despues.desdeOrden === 4, 'después del pase la cadena sigue íntegra y empalma con la histórica', despues);

// Segunda vuelta: no hay nada nuevo que mover (abril sigue abierto)
const r2 = await ejecutarPase({ warn() {}, error: console.error });
ok(r2.every((x) => x.estado === 'OMITIDO'), 'segunda vuelta: solo reintenta lo omitido', r2);

// Manipulación: se altera un registro con el trigger apagado (como lo haría alguien con acceso total) y la verificación lo detecta
await q('DISABLE TRIGGER auditoria_inmutable ON dbo.auditoria');
await q(`UPDATE auditoria SET detalle = N'alterado' WHERE orden = 5`);
await q('ENABLE TRIGGER auditoria_inmutable ON dbo.auditoria');
const rota = await verificarAuditoria();
ok(!rota.ok && rota.problemas.some((p) => p.orden === 5 && /modificado/.test(p.problema)), 'un registro alterado se detecta', rota);

await sa.close(); await hist.close();
console.log(fallas ? `${fallas} FALLAS` : 'pase: todo OK');
process.exit(fallas ? 1 : 0);
