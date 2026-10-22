// URL de la API Banking según el ambiente. No se carga a mano: homologación y producción
// solo difieren en el host (el PDF v1.22.0 documenta homologación, apihomo.bancodevalores.com).
// BDV_URL_HOMO permite apuntar homologación a un simulador; producción no se puede cambiar.
const RUTA = '/CTSProxy/services/resources/channels/mobilebanking';

export const AMBIENTES = {
  homo: { nombre: 'Homologación', host: 'https://apihomo.bancodevalores.com' },
  prod: { nombre: 'Producción', host: 'https://api.bancodevalores.com' },
};

export const esAmbiente = (amb) => Object.hasOwn(AMBIENTES, amb ?? '');

export function urlBase(amb) {
  if (!esAmbiente(amb)) throw new Error(`Ambiente inválido: ${amb}`);
  if (amb === 'homo' && process.env.BDV_URL_HOMO) return process.env.BDV_URL_HOMO.replace(/\/+$/, '');
  return `${AMBIENTES[amb].host}${RUTA}`;
}

// Defensa extra antes de cada login: la URL tiene que ser exactamente la del ambiente.
export const urlDelAmbiente = (amb, url) => esAmbiente(amb) && String(url ?? '').replace(/\/+$/, '') === urlBase(amb);
