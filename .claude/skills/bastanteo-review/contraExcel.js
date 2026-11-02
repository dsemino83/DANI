'use strict';
// El control de un bastanteo contra el Excel del cliente y la equivalencia de letras de grupo viven en valo/motor.js (los usa
// la página y este skill). Este archivo solo los expone con la firma que usan revisar.js y los tests.
// Los puntos (pertenencia, grupo, uso, combinaciones, limite) valen 'ok', 'rev', 'dif' o 'na'; REV es un aviso y DIF un error.
const path = require('path');
const M = require(path.join(__dirname, '..', '..', '..', 'valo', 'motor.js'));

const ORDEN_DE_TIPOS = ['ERROR DE GRUPO', 'ERROR DE PERTENENCIA', 'ERROR DE PARTICIPACIÓN', 'ERROR DE AGRUPAMIENTO', 'ERROR DE REGLA', 'ERROR DE APLICACIÓN', 'AVISO DEL EXCEL'];
module.exports = {
  compararConExcel: (json, cliente) => M.compararConExcel(json, cliente),
  equivalenciaDeLetras: (mA, mB) => M.equivalenciaDeLetras(mA, mB),
  renombrarGrupos: (json, mapa) => M.renombrarGrupos(json, mapa),
  ORIGEN_POR_TIPO: M.ORIGEN_ERROR_EXCEL,
  ORDEN_DE_TIPOS,
};
