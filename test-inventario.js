// Pruebas del inventario de relojes sin internet (hoja en memoria + IA simulada).
import assert from 'node:assert/strict';
import { ejecutarInventario, calcularGanancia } from './inventario-ia.js';
import { conversar } from './ai.js';
import { CAMPOS, planMigracion } from './inventario.js';

// 0) Migración de columnas: "Año" pasa de la columna S a la F (junto a Modelo)
{
  const nuevo = CAMPOS.map(([, t]) => t);
  assert.equal(nuevo[4], 'Modelo');
  assert.equal(nuevo[5], 'Año');
  const viejo = [...nuevo.filter((t) => t !== 'Año'), 'Año'];
  const plan = planMigracion(viejo);
  assert.deepEqual(plan, { tipo: 'mover', desde: 18, hacia: 5 });
  const m = [...viejo];
  m.splice(plan.hacia, 0, m.splice(plan.desde, 1)[0]);
  assert.deepEqual(m, nuevo);
  assert.equal(planMigracion(nuevo), null);
  console.log('✓ migración de columna Año');
}

// --- Inventario en memoria con la misma interfaz que inventario.js ---
let filas = [];
const inv = {
  EN_INVENTARIO: 'en inventario',
  VENDIDO: 'vendido',
  leerRelojes: async () => filas.map((r, i) => ({ ...r, fila: i + 2 })),
  agregarReloj: async (r) => { filas.push({ ...r }); },
  guardarReloj: async (r) => { const { fila, ...resto } = r; filas[fila - 2] = resto; },
  borrarReloj: async (r) => { filas.splice(r.fila - 2, 1); },
};
const ctx = { inv, persona: 'Alvaro', ahora: '2026-10-06 13:20' };
const run = (n, i, c = ctx) => ejecutarInventario(n, i, c);

// 1) Compras
let r = await run('registrar_compra_reloj', { modelo: 'Rolex Datejust 36 verde', anio: 2019, numero_serie: '7XK92A1', costo: 120000, moneda: 'MXN', proveedor: 'Pedro' });
assert.equal(r.ok, true);
assert.equal(r.registrado.anio, '2019');
assert.equal(r.registrado.id, 'R-0001');
assert.equal(r.registrado.estado, 'en inventario');
assert.equal(r.registrado.fecha_compra, '2026-10-06');
r = await run('registrar_compra_reloj', { modelo: 'Omega Speedmaster', numero_serie: 'OM-555', costo: 5200, moneda: 'USD', proveedor: 'Chrono24', fecha: '2026-10-01' });
assert.equal(r.registrado.id, 'R-0002');
r = await run('registrar_compra_reloj', { modelo: 'Tudor Black Bay', costo: 3100, moneda: 'USD', proveedor: 'Juan' }, { ...ctx, persona: 'Juan Carlos' });
assert.equal(r.registrado.id, 'R-0003');
assert.ok(r.aviso); // sin serie
console.log('✓ compras con IDs consecutivos');

// 2) Serie duplicada (ignora espacios/guiones/mayúsculas)
r = await run('registrar_compra_reloj', { modelo: 'Otro', numero_serie: 'om 555', costo: 1, moneda: 'USD', proveedor: 'X' });
assert.match(r.error, /Ya existe/);
assert.equal(filas.length, 3);
console.log('✓ bloquea número de serie duplicado');

// 3) Venta misma moneda → ganancia directa
r = await run('registrar_venta_reloj', { numero_serie: '7xk92a1', cliente: 'Luis', precio: 150000, moneda: 'MXN' });
assert.equal(r.ok, true);
assert.equal(r.vendido.ganancia, 30000);
assert.equal(r.vendido.moneda_ganancia, 'MXN');
assert.equal(r.vendido.vendio, 'Alvaro');
console.log('✓ venta MXN→MXN, ganancia', r.vendido.ganancia);

// 4) No se puede vender dos veces
r = await run('registrar_venta_reloj', { id: 'R-0001', cliente: 'Otro', precio: 1, moneda: 'MXN' });
assert.match(r.error, /ya está marcado como vendido/);
console.log('✓ bloquea doble venta');

// 5) Venta en otra moneda sin tipo de cambio → no guarda nada
r = await run('registrar_venta_reloj', { id: 'R-0002', cliente: 'Ana', precio: 110000, moneda: 'MXN' });
assert.equal(r.necesita_tipo_cambio, true);
assert.equal(filas[1].estado, 'en inventario');
// con tipo de cambio: costo 5200 USD * 18.5 = 96,200 MXN → ganancia 13,800 MXN
r = await run('registrar_venta_reloj', { id: 'r-0002', cliente: 'Ana', precio: 110000, moneda: 'MXN', tipo_cambio: 18.5, fecha: '2026-10-05' });
assert.equal(r.vendido.ganancia, 13800);
assert.equal(r.vendido.moneda_ganancia, 'MXN');
console.log('✓ venta USD→MXN con tipo de cambio, ganancia', r.vendido.ganancia);

// 6) Venta MXN→USD
assert.deepEqual(
  calcularGanancia({ estado: 'vendido', costo: 92500, moneda_costo: 'MXN', precio_venta: 6000, moneda_venta: 'USD', tipo_cambio: 18.5 }),
  { ganancia: 1000, moneda_ganancia: 'USD' }
);
console.log('✓ ganancia MXN→USD');

// 7) Resumen: no mezcla monedas
r = await run('buscar_relojes', {});
assert.equal(r.resumen.piezas_en_inventario, 1);
assert.deepEqual(r.resumen.inversion_en_inventario, { USD: 3100 });
assert.equal(r.resumen.piezas_vendidas, 2);
assert.deepEqual(r.resumen.ventas, { MXN: 260000 });
assert.deepEqual(r.resumen.ganancia, { MXN: 43800 });
r = await run('buscar_relojes', { estado: 'vendido', desde: '2026-10-06' });
assert.equal(r.relojes.length, 1);
r = await run('buscar_relojes', { texto: '2019' });
assert.equal(r.relojes[0].id, 'R-0001');
r = await run('buscar_relojes', { texto: 'speedmaster' });
assert.equal(r.relojes[0].id, 'R-0002');
r = await run('buscar_relojes', { cliente: 'ana' });
assert.equal(r.relojes.length, 1);
console.log('✓ búsquedas y resumen', JSON.stringify(r.resumen.ganancia));

// 8) Corregir precio recalcula ganancia; cancelar venta; borrar
r = await run('corregir_reloj', { id: 'R-0001', campo: 'precio_venta', valor: '$155,000' });
assert.equal(r.ahora.ganancia, 35000);
r = await run('corregir_reloj', { id: 'R-0002', campo: 'anio', valor: 'aprox. 2015' });
assert.equal(r.ahora.anio, 'aprox. 2015');
r = await run('corregir_reloj', { id: 'R-0003', campo: 'numero_serie', valor: 'OM555' });
assert.match(r.error, /otro reloj/);
r = await run('cancelar_venta_reloj', { id: 'R-0002' });
assert.equal(r.ahora.estado, 'en inventario');
assert.equal(r.ahora.cliente, undefined);
r = await run('borrar_reloj', { id: 'R-0003' });
assert.equal(filas.length, 2);
r = await run('registrar_compra_reloj', { modelo: 'Nuevo', costo: 10, moneda: 'USD', proveedor: 'X' });
assert.equal(r.registrado.id, 'R-0003'); // siguiente id tras borrar el último
console.log('✓ corregir / cancelar venta / borrar');

// 9) Integración con la IA: herramientas expuestas y despachadas
{
  const llamadas = [];
  const guion = [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x', name: 'buscar_relojes', input: { estado: 'en inventario' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Tienes 2 relojes.' }] },
  ];
  const cliente = { messages: { create: async (req) => { llamadas.push(JSON.parse(JSON.stringify(req))); return guion.shift(); } } };
  const datos = { leerGastos: async () => [], agregarGasto: async () => {}, actualizarCampo: async () => {}, borrarFila: async () => {} };
  const resp = await conversar('¿qué relojes tengo?', { persona: 'Alvaro', ahora: '2026-10-06 13:20', personas: ['Alvaro'], datos, inv, cliente });
  assert.equal(resp, 'Tienes 2 relojes.');
  assert.ok(llamadas[0].tools.some((t) => t.name === 'registrar_venta_reloj'));
  assert.match(llamadas[0].system, /INVENTARIO DE RELOJES/);
  const res = JSON.parse(llamadas[1].messages.at(-1).content[0].content);
  assert.equal(res.resumen.piezas_en_inventario, 2);
  console.log('✓ integración con la IA');
}

console.log('\nInventario: todas las pruebas pasaron ✅');
