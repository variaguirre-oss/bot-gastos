// Conversación con IA (Claude) para registrar y consultar gastos en lenguaje natural.
import Anthropic from '@anthropic-ai/sdk';
import { CATEGORIAS } from './parser.js';
import { HERRAMIENTAS_INVENTARIO, INSTRUCCIONES_INVENTARIO, ejecutarInventario } from './inventario-ia.js';

const MODELO = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
const MAX_PASOS = 8; // vueltas máximas de herramientas por mensaje
const MAX_HISTORIAL = 12; // mensajes recordados por persona

let cliente = null;
function getCliente() {
  if (!cliente) cliente = new Anthropic(); // usa ANTHROPIC_API_KEY
  return cliente;
}
export function iaDisponible() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Memoria corta de la conversación (se borra si el servidor se reinicia).
const historiales = new Map();
function historial(persona) {
  if (!historiales.has(persona)) historiales.set(persona, []);
  return historiales.get(persona);
}

const HERRAMIENTAS = [
  {
    name: 'registrar_gasto',
    description:
      'Registra un gasto nuevo en la hoja. Úsala solo cuando el usuario diga claramente que gastó o pagó algo con un monto concreto.',
    input_schema: {
      type: 'object',
      properties: {
        monto: { type: 'number', description: 'Monto positivo.' },
        moneda: {
          type: 'string',
          enum: ['MXN', 'USD'],
          description: 'MXN (pesos) o USD (dólares). Usa USD si el usuario dice dólares/usd/dls o si el contexto lo indica.',
        },
        categoria: {
          type: 'string',
          description:
            'Categoría en minúsculas. Usa una de las categorías existentes si encaja; si el usuario pide una nueva (ej. "labels"), úsala tal cual.',
        },
        descripcion: { type: 'string', description: 'Descripción breve, ej. "tacos", "datejust rosa (Stellar)".' },
        fecha: {
          type: 'string',
          description: 'Fecha del gasto YYYY-MM-DD. Omitir si fue hoy.',
        },
      },
      required: ['monto', 'moneda', 'categoria', 'descripcion'],
    },
  },
  {
    name: 'buscar_gastos',
    description:
      'Busca gastos registrados y devuelve totales calculados (total, por categoría, por persona) y la lista de gastos con su id. Úsala SIEMPRE antes de dar cualquier cifra.',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD (incluida).' },
        hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD (incluida).' },
        persona: { type: 'string', description: 'Nombre de la persona, si se pregunta por alguien.' },
        categoria: { type: 'string', description: 'Categoría exacta a filtrar.' },
        texto: { type: 'string', description: 'Palabra a buscar en la descripción.' },
        moneda: { type: 'string', enum: ['MXN', 'USD'], description: 'Filtrar por moneda (opcional).' },
      },
    },
  },
  {
    name: 'corregir_gasto',
    description: 'Cambia un dato de un gasto ya registrado. Necesita el id que devuelve buscar_gastos.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        campo: { type: 'string', enum: ['monto', 'categoria', 'descripcion', 'fecha', 'moneda'] },
        valor: { type: 'string', description: 'Nuevo valor. Fecha en YYYY-MM-DD; categoría en minúsculas.' },
      },
      required: ['id', 'campo', 'valor'],
    },
  },
  {
    name: 'borrar_gasto',
    description:
      'Borra un gasto. Necesita el id de buscar_gastos. Solo úsala si el usuario pidió borrar ese gasto específico.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
    },
  },
];

const NOMBRES_INVENTARIO = new Set(HERRAMIENTAS_INVENTARIO.map((h) => h.name));
const herramientas = (ctx) => (ctx.inv ? [...HERRAMIENTAS, ...HERRAMIENTAS_INVENTARIO] : HERRAMIENTAS);

function instrucciones({ persona, ahora, personas, categorias, inv }) {
  return `Eres el asistente por WhatsApp de un pequeño negocio/sociedad en México: llevas sus gastos${inv ? ' y su inventario de relojes' : ''}. Hablas en español mexicano, amable y breve.

Hoy es ${ahora} (zona horaria de México). Te escribe: ${persona}.
Personas que usan el bot: ${personas.join(', ')}.
Categorías que ya existen: ${categorias.join(', ')}.

Reglas:
- NUNCA inventes cifras. Para cualquier total, suma o comparación usa buscar_gastos y reporta los números que devuelve.
- Si el usuario dice que gastó algo, regístralo con registrar_gasto. Si el monto no está claro, pregunta antes de registrar.
- Las categorías son libres: si el usuario indica una categoría (aunque no exista), úsala en minúsculas sin cuestionarla. Si no indica ninguna, elige la existente que mejor encaje.
- Si mandan una lista de varios gastos, registra cada renglón por separado (puedes llamar registrar_gasto varias veces) y al final confirma con un resumen y el total.
- Si un encabezado agrupa renglones (ej. "Labels de Stellar"), incluye ese contexto en la descripción de cada gasto (ej. "datejust rosa (Stellar)").
- Interpreta fechas relativas ("ayer", "el lunes", "la semana pasada", "septiembre") con base en la fecha de hoy. Las semanas empiezan en lunes.
- Para corregir o borrar, primero busca el gasto para obtener su id. Si hay varios posibles, pregunta cuál.
- Cada gasto tiene moneda: MXN (pesos) o USD (dólares). Formato: pesos $1,234.50 y dólares US$61.73.
- NUNCA sumes ni compares pesos con dólares como si fueran lo mismo: buscar_gastos ya devuelve los totales separados por moneda; repórtalos por separado.
- Si no está claro en qué moneda es un gasto, pregunta antes de registrarlo. Si el usuario ya te dijo la moneda en la conversación (ej. "son dólares"), úsala para toda esa lista.
- Respuestas cortas, aptas para WhatsApp (usa *negritas* con un asterisco, sin tablas ni markdown de títulos).
- Si preguntan algo que no tiene que ver con gastos${inv ? ' ni inventario' : ''}, responde brevemente y recuerda en qué puedes ayudar.
${inv ? INSTRUCCIONES_INVENTARIO : ''}`;
}

function filtrar(gastos, { desde, hasta, persona, categoria, texto, moneda }) {
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  return gastos.filter((g) => {
    const dia = g.fecha.slice(0, 10);
    if (desde && dia < desde) return false;
    if (hasta && dia > hasta) return false;
    if (persona && !norm(g.persona).includes(norm(persona))) return false;
    if (categoria && norm(g.categoria) !== norm(categoria)) return false;
    if (texto && !norm(g.descripcion).includes(norm(texto))) return false;
    if (moneda && (g.moneda || 'MXN') !== moneda) return false;
    return true;
  });
}

const r2 = (n) => Math.round(n * 100) / 100;
// Totales agrupados por moneda: { MXN: {...}, USD: {...} }
function totales(gastos, clave) {
  const m = {};
  for (const g of gastos) {
    const mon = g.moneda || 'MXN';
    m[mon] ??= {};
    m[mon][g[clave]] = r2((m[mon][g[clave]] || 0) + g.monto);
  }
  return m;
}
function totalPorMoneda(gastos) {
  const m = {};
  for (const g of gastos) m[g.moneda || 'MXN'] = r2((m[g.moneda || 'MXN'] || 0) + g.monto);
  return m;
}

export function limpiarCategoria(c) {
  const t = String(c || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
  return t || 'otros';
}

const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

async function ejecutar(nombre, input, ctx) {
  const { datos, persona, ahora } = ctx;
  if (NOMBRES_INVENTARIO.has(nombre)) {
    if (!ctx.inv) return { error: 'El inventario no está configurado.' };
    return ejecutarInventario(nombre, input, ctx);
  }
  switch (nombre) {
    case 'registrar_gasto': {
      const monto = Number(input.monto);
      if (!(monto > 0)) return { error: 'Monto inválido' };
      const categoria = limpiarCategoria(input.categoria);
      const moneda = input.moneda === 'USD' ? 'USD' : 'MXN';
      const hoy = ahora.slice(0, 10);
      const fecha = esFecha(input.fecha) && input.fecha !== hoy ? `${input.fecha} 12:00` : ahora;
      await datos.agregarGasto({
        fecha,
        persona,
        monto,
        categoria,
        descripcion: String(input.descripcion || '').slice(0, 200),
        moneda,
      });
      return { ok: true, registrado: { fecha: fecha.slice(0, 10), monto, moneda, categoria, descripcion: input.descripcion } };
    }
    case 'buscar_gastos': {
      const todos = await datos.leerGastos();
      const lista = filtrar(todos, input);
      return {
        cantidad: lista.length,
        total_por_moneda: totalPorMoneda(lista),
        por_categoria: totales(lista, 'categoria'),
        por_persona: totales(lista, 'persona'),
        // Los más recientes primero; se limita para no saturar.
        gastos: lista
          .slice(-40)
          .reverse()
          .map((g) => ({ id: g.fila, fecha: g.fecha, persona: g.persona, monto: g.monto, moneda: g.moneda || 'MXN', categoria: g.categoria, descripcion: g.descripcion })),
        nota: lista.length > 40 ? 'Lista recortada a los 40 más recientes; los totales sí incluyen todos.' : undefined,
      };
    }
    case 'corregir_gasto': {
      const todos = await datos.leerGastos();
      const g = todos.find((x) => x.fila === input.id);
      if (!g) return { error: 'No existe un gasto con ese id. Vuelve a buscar.' };
      let valor = input.valor;
      if (input.campo === 'monto') {
        valor = Number(String(valor).replace(/[$,]/g, ''));
        if (!(valor > 0)) return { error: 'Monto inválido' };
      }
      if (input.campo === 'moneda') {
        valor = String(valor).toUpperCase();
        if (!['MXN', 'USD'].includes(valor)) return { error: 'Moneda debe ser MXN o USD' };
      }
      if (input.campo === 'categoria') {
        valor = limpiarCategoria(valor);
      }
      if (input.campo === 'fecha') {
        if (!esFecha(valor)) return { error: 'Fecha debe ser YYYY-MM-DD' };
        valor = `${valor} ${g.fecha.slice(11, 16) || '12:00'}`;
      }
      await datos.actualizarCampo(g.fila, input.campo, valor);
      return { ok: true, antes: g, campo: input.campo, nuevo_valor: valor };
    }
    case 'borrar_gasto': {
      const todos = await datos.leerGastos();
      const g = todos.find((x) => x.fila === input.id);
      if (!g) return { error: 'No existe un gasto con ese id. Vuelve a buscar.' };
      await datos.borrarFila(g.fila);
      return { ok: true, borrado: g, aviso: 'Los ids cambiaron; busca de nuevo si necesitas otro.' };
    }
    default:
      return { error: `Herramienta desconocida: ${nombre}` };
  }
}

/**
 * Responde un mensaje libre usando Claude.
 * ctx = { persona, ahora: 'YYYY-MM-DD HH:MM', personas: [...], datos: {leerGastos, agregarGasto, actualizarCampo, borrarFila}, cliente? }
 */
export async function conversar(texto, ctx) {
  const claude = ctx.cliente || getCliente();
  const hist = historial(ctx.persona);
  const mensajes = [...hist, { role: 'user', content: texto }];
  let existentes = [];
  try {
    existentes = (await ctx.datos.leerGastos()).map((g) => g.categoria);
  } catch {}
  const categorias = [...new Set([...CATEGORIAS, ...existentes.filter(Boolean)])];
  const sistema = instrucciones({ ...ctx, categorias });

  for (let paso = 0; paso < MAX_PASOS; paso++) {
    const r = await claude.messages.create({
      model: MODELO,
      max_tokens: 1500,
      system: sistema,
      tools: herramientas(ctx),
      messages: mensajes,
    });

    mensajes.push({ role: 'assistant', content: r.content });

    if (r.stop_reason !== 'tool_use') {
      const respuesta =
        r.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim() || 'Listo.';
      hist.push({ role: 'user', content: texto }, { role: 'assistant', content: respuesta });
      while (hist.length > MAX_HISTORIAL) hist.splice(0, 2);
      return respuesta;
    }

    const resultados = [];
    for (const b of r.content) {
      if (b.type !== 'tool_use') continue;
      let salida;
      try {
        salida = await ejecutar(b.name, b.input, ctx);
      } catch (e) {
        console.error('Error en herramienta', b.name, e);
        salida = { error: 'Falló la operación con la hoja de cálculo.' };
      }
      resultados.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(salida) });
    }
    mensajes.push({ role: 'user', content: resultados });
  }
  return 'Uy, me enredé con esa. ¿Me lo puedes decir de otra forma?';
}

export function olvidar(persona) {
  historiales.delete(persona);
}
