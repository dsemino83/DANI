// Prueba de SOLO LECTURA contra la API Banking del Banco de Valores (homologación o producción).
// Hace login, getUserEntityInformation y getOwnAccounts. Nunca llama a una API de transferencia.
//
// Uso (Node 18+; la credencial va por variables de entorno, nunca en el archivo):
//   BDV_AMBIENTE=prod BDV_LOGIN=... BDV_PASSWORD_CIFRADA='<base64 RSA>' BDV_TERMINAL=... \
//   BDV_IDENTIFICATION=... node scripts/probar-api.mjs
//   (opcional) BDV_MOVIMIENTOS=<nro de cuenta>: además trae los movimientos del día de esa cuenta.
const HOSTS = { homo: 'https://apihomo.bancodevalores.com', prod: 'https://api.bancodevalores.com' };
const amb = process.env.BDV_AMBIENTE ?? 'homo';
if (!HOSTS[amb]) throw new Error('BDV_AMBIENTE debe ser homo o prod');
// BDV_URL_HOMO (solo homologación) apunta a un simulador, igual que en el backend.
const base = amb === 'homo' && process.env.BDV_URL_HOMO ? process.env.BDV_URL_HOMO.replace(/\/+$/, '') : `${HOSTS[amb]}/CTSProxy/services/resources/channels/mobilebanking`;
const falta = ['BDV_LOGIN', 'BDV_PASSWORD_CIFRADA', 'BDV_TERMINAL', 'BDV_IDENTIFICATION'].filter((k) => !process.env[k]);
if (falta.length) throw new Error(`Faltan variables: ${falta.join(', ')}`);

const enmascarar = (v) => { const s = String(v ?? ''); return s.length > 6 ? `${s.slice(0, 3)}•••${s.slice(-3)}` : '•••'; };
const dinero = (v) => Number(v ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let cookie = '';
async function post(ruta, body) {
  const res = await fetch(`${base}/${ruta}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

console.log(`Ambiente: ${amb} · ${base}`);
const login = await post('security/login', {
  login: process.env.BDV_LOGIN,
  password: process.env.BDV_PASSWORD_CIFRADA, // ya cifrada con la llave pública RSA del banco
  terminal: process.env.BDV_TERMINAL,
  channel: process.env.BDV_CHANNEL ?? '3',
  identification: process.env.BDV_IDENTIFICATION,
});
if (!login.res.ok || !login.json?.success) {
  console.log(`login rechazado · HTTP ${login.res.status} · ${login.json?.message?.code ?? ''} ${login.json?.message?.message ?? ''}`);
  process.exit(1);
}
cookie = (login.res.headers.getSetCookie?.() ?? []).map((v) => v.split(';')[0]).join('; ');
console.log(`login OK · cookie de sesión ${cookie ? 'recibida' : 'NO recibida'}`);

const ent = await post('enrollment/getUserEntityInformation', {});
console.log(`getUserEntityInformation · HTTP ${ent.res.status} · success ${ent.json?.success} · ${ent.json?.completeName ?? ''}`);

const cuentas = await post('accounts/getOwnAccounts', {});
const lista = cuentas.json?.accountsArray ?? [];
console.log(`getOwnAccounts · HTTP ${cuentas.res.status} · ${lista.length} cuentas`);
for (const c of lista) {
  const moneda = Number(c.currencyId) === 80 ? 'ARS' : 'USD';
  console.log(`  ${enmascarar(c.productNumber)} · ${c.productName ?? ''} · ${moneda} · disponible ${dinero(c.availableBalance)}`);
}

const cta = process.env.BDV_MOVIMIENTOS;
if (cta) {
  const c = lista.find((x) => String(x.productNumber) === cta);
  if (!c) console.log('La cuenta de BDV_MOVIMIENTOS no está entre las cuentas propias');
  else {
    const d = new Date(), hoy = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
    const m = await post('accounts/getMovementsDetail', {
      productId: c.productId, currencyId: c.currencyId, productNumber: c.productNumber,
      numberOfMovements: 900, sequential: '0', uniqueSequential: '0', initialDate: hoy, finalDate: hoy, mode: '0', serviceId: '3',
    });
    const movs = m.json?.accountStatementArray ?? [];
    console.log(`getMovementsDetail (hoy) · HTTP ${m.res.status} · ${movs.length} movimientos`);
    for (const x of movs.slice(0, 10)) console.log(`  ${x.processDate} ${x.hour} · ${x.signDC} ${dinero(x.amount)} · ${x.description ?? ''}`);
  }
}
console.log('Fin: no se llamó a ninguna API de transferencia.');
