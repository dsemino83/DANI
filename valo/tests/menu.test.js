'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../motor.js');

const ids = (sec, cfg) => M.menuFuncionesDe(sec, cfg).map(f => f.id);
const nombres = (sec, cfg) => M.menuFuncionesDe(sec, cfg).map(f => f.nombre);

test('las tres tarjetas aparecen según las autorizaciones del usuario', () => {
  assert.deepEqual(M.menuSectoresDe('a@valo.ar', null).map(s => s.id), ['activas', 'sac', 'fideicomisos']);
  const cfg = { usuarios: { 'Ana@valo.ar': { sectores: ['sac'] }, 'luis@valo.ar': { sectores: [] } } };
  assert.deepEqual(M.menuSectoresDe('ana@VALO.ar', cfg).map(s => s.id), ['sac'], 'el correo no distingue mayúsculas');
  assert.deepEqual(M.menuSectoresDe('luis@valo.ar', cfg), [], 'sin sectores habilitados no ve ninguno');
  assert.equal(M.menuSectoresDe('otro@valo.ar', cfg).length, 3, 'sin restricción cargada para su correo ve todos');
  // una restricción nunca amplía: un sector inexistente en la lista no agrega nada
  assert.deepEqual(M.menuSectoresDe('ana@valo.ar', { usuarios: { 'ana@valo.ar': { sectores: ['sac', 'inexistente'] } } }).map(s => s.id), ['sac']);
});

test('ACTIVAS muestra exactamente sus diez funcionalidades, SAC una y FIDEICOMISOS cuatro', () => {
  assert.deepEqual(nombres('activas'), ['Carga de lote', 'Clientes', 'Bancos', 'Bancos MELI', 'Padrones', 'Historial', 'Cartera', 'Saldo de deuda', 'Descuento de cheques', 'Inventarios']);
  assert.deepEqual(nombres('sac'), ['Bastanteo']);
  assert.deepEqual(nombres('fideicomisos'), ['NO COBIS MELI', 'Carga de lote', 'Clientes', 'Historial']);
});

test('Carga de lote, Clientes e Historial aparecen de forma independiente en ACTIVAS y FIDEICOMISOS', () => {
  ['carga_lote', 'clientes', 'historial'].forEach(f => {
    assert.ok(ids('activas').includes(f) && ids('fideicomisos').includes(f), f);
    // quitar el par de ACTIVAS no toca FIDEICOMISOS, y al revés
    const sinA = { asignaciones: M.MENU_ASIGNACIONES.filter(a => !(a.sector === 'activas' && a.funcion === f)) };
    assert.ok(!ids('activas', sinA).includes(f) && ids('fideicomisos', sinA).includes(f), 'quitar de ACTIVAS: ' + f);
    const sinF = { asignaciones: M.MENU_ASIGNACIONES.filter(a => !(a.sector === 'fideicomisos' && a.funcion === f)) };
    assert.ok(ids('activas', sinF).includes(f) && !ids('fideicomisos', sinF).includes(f), 'quitar de FIDEICOMISOS: ' + f);
  });
});

test('modificar una asignación no modifica las otras; una función no asignada nunca aparece', () => {
  const base = ['activas', 'sac', 'fideicomisos'].map(s => ids(s));
  const cfg = { asignaciones: M.MENU_ASIGNACIONES.concat([{ sector: 'sac', funcion: 'padrones' }]) };
  assert.deepEqual(ids('sac', cfg), ['bastanteo', 'padrones']);
  assert.deepEqual([ids('activas', cfg), ids('fideicomisos', cfg)], [base[0], base[2]], 'ACTIVAS y FIDEICOMISOS siguen igual');
  assert.ok(!ids('sac').includes('padrones') && !ids('fideicomisos').includes('bancos') && !ids('activas').includes('bastanteo'), 'sin asignación no aparece');
  assert.deepEqual(ids('inexistente'), [], 'un sector sin asignaciones queda vacío (la pantalla muestra el aviso)');
  // pares inválidos (sector o función que no existen) se descartan y los repetidos se unifican
  const raro = { asignaciones: [{ sector: 'sac', funcion: 'nada' }, { sector: 'x', funcion: 'bancos' }, { sector: 'sac', funcion: 'bancos' }, { sector: 'sac', funcion: 'bancos' }] };
  assert.deepEqual(ids('sac', raro), ['bancos']);
});

test('identificadores independientes del nombre visible y de la pantalla; no hay rutas ni pantallas duplicadas', () => {
  Object.entries(M.MENU_FUNCIONES).forEach(([id, f]) => { assert.notEqual(id, f.nombre); assert.ok(f.vista); });
  const vistas = Object.values(M.MENU_FUNCIONES).map(f => f.vista);
  assert.equal(new Set(vistas).size, vistas.length, 'cada función apunta a su propia pantalla existente');
  assert.equal(new Set(M.MENU_SECTORES.map(s => s.id)).size, M.MENU_SECTORES.length);
});

test('URL directa: solo abre una función asignada a ESE sector y con el sector autorizado', () => {
  assert.deepEqual(M.menuResolverRuta('#/activas/carga_lote', 'a@valo.ar'), { sector: 'activas', funcion: 'carga_lote' });
  assert.deepEqual(M.menuResolverRuta('#/fideicomisos/carga_lote', 'a@valo.ar'), { sector: 'fideicomisos', funcion: 'carga_lote' });
  assert.deepEqual(M.menuResolverRuta('#/sac', 'a@valo.ar'), { sector: 'sac', funcion: null });
  assert.equal(M.menuResolverRuta('#/sac/bancos', 'a@valo.ar'), null, 'cambiar el sector del enlace no habilita una función ajena');
  assert.equal(M.menuResolverRuta('#/fideicomisos/bancos', 'a@valo.ar'), null);
  assert.equal(M.menuResolverRuta('#/activas/bastanteo', 'a@valo.ar'), null);
  assert.equal(M.menuResolverRuta('#/nada/carga_lote', 'a@valo.ar'), null);
  assert.equal(M.menuResolverRuta('#/activas/../sac', 'a@valo.ar'), null);
  const cfg = { usuarios: { 'ana@valo.ar': { sectores: ['sac'] } } };
  assert.equal(M.menuResolverRuta('#/activas/carga_lote', 'ana@valo.ar', cfg), null, 'sin autorización para el sector no hay acceso por URL');
  assert.equal(M.menuResolverRuta('#/activas', 'ana@valo.ar', cfg), null);
  assert.deepEqual(M.menuResolverRuta('#/sac/bastanteo', 'ana@valo.ar', cfg), { sector: 'sac', funcion: 'bastanteo' });
  assert.equal(M.menuPuedeAbrir('ana@valo.ar', 'fideicomisos', 'historial', cfg), false);
});

test('el contexto se conserva: la misma pantalla se abre en el sector desde el que se entró; el regreso es por ruta', () => {
  assert.deepEqual(M.menuSectorParaVista('lote', 'fideicomisos', 'a@valo.ar'), { sector: 'fideicomisos', funcion: 'carga_lote' });
  assert.deepEqual(M.menuSectorParaVista('lote', 'activas', 'a@valo.ar'), { sector: 'activas', funcion: 'carga_lote' });
  assert.deepEqual(M.menuSectorParaVista('lote', null, 'a@valo.ar'), { sector: 'activas', funcion: 'carga_lote' }, 'sin contexto: el primer sector que la tiene');
  assert.deepEqual(M.menuSectorParaVista('clientes', 'sac', 'a@valo.ar'), { sector: 'activas', funcion: 'clientes' }, 'SAC no la tiene: cae en el primero que sí');
  const cfg = { usuarios: { 'ana@valo.ar': { sectores: ['fideicomisos'] } } };
  assert.deepEqual(M.menuSectorParaVista('clientes', 'activas', 'ana@valo.ar', cfg), { sector: 'fideicomisos', funcion: 'clientes' });
  assert.equal(M.menuSectorParaVista('bancos', null, 'ana@valo.ar', cfg), null, 'Bancos no está en sus sectores');
  assert.equal(M.menuRuta('activas'), '#/activas');
  assert.equal(M.menuRuta('activas', 'bancos'), '#/activas/bancos');
});
