// Prueba local del flujo de IA sin internet: hoja en memoria + IA simulada.
import assert from 'node:assert/strict';
import { conversar } from './ai.js';
import { esFormatoRapido } from './parser.js';

// --- Ruteo formato rápido vs IA ---
const rapidos = ['250 comida tacos', '$85 uber', 'comida 300 pizza', '500', '1,200.50 super despensa'];
const ia = ['ayer gasté 480 en el súper', '¿cuánto llevamos en comida?', 'cuanto gastamos en septiembre?', 'hola qué tal', 'le pagué 1200 al plomero el lunes por la tarde'];
for (const t of rapidos) assert.equal(esFormatoRapido(t), true, t);
for (const t of ia) assert.equal(esFormatoRapido(t), false, t);
console.log('✓ ruteo');

// --- Hoja en memoria ---
let filas = [
  { fecha: '2026-10-01 10:00', persona: 'Alvaro', monto: 250, categoria: 'comida', descripcion: 'tacos' },
  { fecha: '2026-10-03 19:00', persona: 'Juan Carlos', monto: 900, categoria: 'super', descripcion: 'despensa' },
  { fecha: '2026-09-20 09:00', persona: 'Alvaro', monto: 100, categoria: 'comida', descripcion: 'café' },
];
const datos = {
  leerGastos: async () => filas.map((g, i) => ({ ...g, fila: i + 2 })),
  agregarGasto: async (g) => { filas.push(g); },
  actualizarCampo: async (fila, campo, valor) => { filas[fila - 2][campo] = valor; },
  borrarFila: async (fila) => { filas.splice(fila - 2, 1); },
};

// --- IA simulada: devuelve respuestas guionadas y guarda lo que recibe ---
function clienteFalso(guion) {
  const llamadas = [];
  return {
    llamadas,
    messages: {
      create: async (req) => {
        llamadas.push(JSON.parse(JSON.stringify(req)));
        return guion.shift();
      },
    },
  };
}
const usar = (id, name, input) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });
const decir = (text) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
const ctx = (cliente, persona = 'Alvaro') => ({ persona, ahora: '2026-10-05 16:40', personas: ['Alvaro', 'Juan Carlos'], datos, cliente });

// 1) Registrar en lenguaje natural con fecha pasada
{
  const c = clienteFalso([
    usar('t1', 'registrar_gasto', { monto: 480, categoria: 'super', descripcion: 'súper', fecha: '2026-10-04' }),
    decir('✅ Registré $480.00 en super (ayer).'),
  ]);
  const r = await conversar('ayer gasté 480 en el súper', ctx(c));
  assert.equal(filas.at(-1).monto, 480);
  assert.equal(filas.at(-1).fecha, '2026-10-04 12:00');
  assert.equal(filas.at(-1).persona, 'Alvaro');
  const res = JSON.parse(c.llamadas[1].messages.at(-1).content[0].content);
  assert.equal(res.ok, true);
  assert.match(c.llamadas[0].system, /Hoy es 2026-10-05/);
  console.log('✓ registrar:', r);
}

// 2) Pregunta: totales calculados por el código, no por la IA
{
  const c = clienteFalso([
    usar('t2', 'buscar_gastos', { desde: '2026-10-01', hasta: '2026-10-31', categoria: 'comida' }),
    decir('Este mes llevan *$250.00* en comida.'),
  ]);
  await conversar('¿cuánto llevamos en comida este mes?', ctx(c));
  const res = JSON.parse(c.llamadas[1].messages.at(-1).content[0].content);
  assert.equal(res.total, 250);
  assert.equal(res.cantidad, 1);
  console.log('✓ buscar: total', res.total);
}

// 3) Por persona en octubre
{
  const c = clienteFalso([usar('t3', 'buscar_gastos', { desde: '2026-10-01' }), decir('ok')]);
  await conversar('¿quién ha gastado más?', ctx(c));
  const res = JSON.parse(c.llamadas[1].messages.at(-1).content[0].content);
  assert.deepEqual(res.por_persona, { Alvaro: 730, 'Juan Carlos': 900 });
  console.log('✓ por persona', res.por_persona);
}

// 4) Corregir categoría y borrar
{
  const c = clienteFalso([
    usar('t4', 'corregir_gasto', { id: 2, campo: 'categoria', valor: 'transporte' }),
    decir('Corregido.'),
  ]);
  await conversar('lo de los tacos era transporte', ctx(c));
  assert.equal(filas[0].categoria, 'transporte');
  const c2 = clienteFalso([usar('t5', 'borrar_gasto', { id: 4 }), decir('Borrado.')]);
  await conversar('borra lo del café', ctx(c2));
  assert.equal(filas.some((g) => g.descripcion === 'café'), false);
  const c3 = clienteFalso([usar('t6', 'corregir_gasto', { id: 99, campo: 'monto', valor: '10' }), decir('No lo encontré')]);
  await conversar('cambia algo', ctx(c3));
  const res = JSON.parse(c3.llamadas[1].messages.at(-1).content[0].content);
  assert.ok(res.error);
  console.log('✓ corregir / borrar / id inválido');
}

// 5) Memoria: el historial del mismo usuario se envía en la siguiente pregunta
{
  const c = clienteFalso([decir('¡Hola!')]);
  await conversar('hola', ctx(c, 'Juan Carlos'));
  const c2 = clienteFalso([decir('Claro')]);
  await conversar('y de ayer?', ctx(c2, 'Juan Carlos'));
  assert.equal(c2.llamadas[0].messages.length, 3);
  console.log('✓ memoria por persona');
}

console.log('\nTodas las pruebas pasaron ✅');
