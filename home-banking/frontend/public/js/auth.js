// Login OIDC con Authorization Code + PKCE contra el SSO de VALO (Keycloak, realm staff).
// La SPA nunca ve la contraseña. Tokens en sessionStorage (se borran al cerrar la pestaña).
let cfg = null;
const K = 'hb.tokens', V = 'hb.pkce';
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const azar = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const ep = (p) => `${cfg.oidcIssuer}/protocol/openid-connect/${p}`;
const redirect = () => `${location.origin}/`;

const leer = () => { try { return JSON.parse(sessionStorage.getItem(K)); } catch { return null; } };
const guardar = (t) => sessionStorage.setItem(K, JSON.stringify({ ...t, vence: Date.now() + (t.expires_in - 20) * 1000 }));

export async function iniciar() {
  cfg = await (await fetch('/config.json', { cache: 'no-store' })).json();
  const q = new URLSearchParams(location.search);
  if (q.get('code')) await canjearCodigo(q.get('code'), q.get('state'));
  else if (q.get('error')) throw new Error(q.get('error_description') ?? q.get('error'));
  return cfg;
}

export const autenticado = () => !!leer();

export async function login() {
  const verificador = azar(48), state = azar(16);
  sessionStorage.setItem(V, JSON.stringify({ verificador, state }));
  const reto = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verificador)));
  const u = new URL(ep('auth'));
  u.search = new URLSearchParams({ client_id: cfg.oidcClientId, redirect_uri: redirect(), response_type: 'code', scope: 'openid', state, code_challenge: reto, code_challenge_method: 'S256' });
  location.assign(u);
}

async function canjearCodigo(code, state) {
  const pkce = JSON.parse(sessionStorage.getItem(V) ?? 'null');
  sessionStorage.removeItem(V);
  history.replaceState(null, '', location.pathname + location.hash);
  if (!pkce || pkce.state !== state) throw new Error('Respuesta de login inválida (state). Volvé a ingresar.');
  const res = await fetch(ep('token'), {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: cfg.oidcClientId, redirect_uri: redirect(), code_verifier: pkce.verificador }),
  });
  if (!res.ok) throw new Error('No se pudo completar el ingreso');
  guardar(await res.json());
}

let renovando = null;
async function renovar(t) {
  const res = await fetch(ep('token'), {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: cfg.oidcClientId }),
  });
  if (!res.ok) { sessionStorage.removeItem(K); throw new Error('La sesión venció'); }
  guardar(await res.json());
}

// Access token vigente (renueva con el refresh token si está por vencer)
export async function token() {
  const t = leer();
  if (!t) throw new Error('Sin sesión');
  if (Date.now() < t.vence) return t.access_token;
  renovando ??= renovar(t).finally(() => { renovando = null; });
  await renovando;
  return leer().access_token;
}

export function logout() {
  const t = leer();
  sessionStorage.clear();
  const u = new URL(ep('logout'));
  u.search = new URLSearchParams({ client_id: cfg.oidcClientId, post_logout_redirect_uri: redirect(), ...(t?.id_token ? { id_token_hint: t.id_token } : {}) });
  location.assign(u);
}
