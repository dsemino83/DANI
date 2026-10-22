// Errores con código HTTP que el manejador global devuelve como JSON.
export class ErrorHttp extends Error {
  constructor(status, codigo, mensaje) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
  }
}

export const noAutorizado = (m = 'Sesión inválida o vencida') => new ErrorHttp(401, 'no_autenticado', m);
export const prohibido = (m = 'No tenés permiso para esta acción') => new ErrorHttp(403, 'prohibido', m);
export const noEncontrado = (m = 'No encontrado') => new ErrorHttp(404, 'no_encontrado', m);
export const invalido = (m) => new ErrorHttp(400, 'invalido', m);
export const conflicto = (m) => new ErrorHttp(409, 'conflicto', m);
