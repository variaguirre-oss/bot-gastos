// Herramientas de IA para el inventario de relojes.
import { EN_INVENTARIO, VENDIDO } from './inventario.js';

const MONEDAS = ['MXN', 'USD'];
const r2 = (n) => Math.round(n * 100) / 100;
const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
const normSerie = (s) => norm(s).replace(/[\s-]/g, '');

export const HERRAMIENTAS_INVENTARIO = [
  {
    name: 'registrar_compra_reloj',
    description: 'Da de alta en el inventario un reloj que se compró. Una llamada por cada pieza.',
    input_schema: {
      type: 'object',
      properties: {
        modelo: { type: 'string', description: 'Marca, modelo y variante tal como lo dice el usuario, ej. "Rolex Datejust 36 esfera verde".' },
        numero_serie: { type: 'string', description: 'Número de serie. Si el usuario no lo tiene, omítelo.' },
        costo: { type: 'number', description: 'Cuánto costó la pieza.' },
        moneda: { type: 'string', enum: MONEDAS },
        proveedor: { type: 'string', description: 'A quién se le compró.' },
        fecha: { type: 'string', description: 'Fecha de compra YYYY-MM-DD. Omitir si fue hoy.' },
        notas: { type: 'string', description: 'Detalles extra: estado, caja y papeles, año, etc.' },
      },
      required: ['modelo', 'costo', 'moneda', 'proveedor'],
    },
  },
  {
    name: 'registrar_venta_reloj',
    description:
      'Marca como vendido un reloj del inventario y calcula la ganancia. Identifícalo por id (de buscar_relojes) o por número de serie.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID del reloj, ej. "R-0003".' },
        numero_serie: { type: 'string' },
        cliente: { type: 'string', description: 'A quién se le vendió.' },
        precio: { type: 'number', description: 'Precio de venta.' },
        moneda: { type: 'string', enum: MONEDAS },
        tipo_cambio: {
          type: 'number',
          description: 'Pesos por 1 dólar. Solo se necesita si la moneda de venta es distinta a la de compra; pídeselo al usuario, no lo inventes.',
        },
        fecha: { type: 'string', description: 'Fecha de venta YYYY-MM-DD. Omitir si fue hoy.' },
        notas: { type: 'string' },
      },
      required: ['cliente', 'precio', 'moneda'],
    },
  },
  {
    name: 'buscar_relojes',
    description:
      'Busca relojes y devuelve la lista y un resumen calculado (piezas en inventario, inversión, ventas y ganancia por moneda). Úsala SIEMPRE antes de dar cifras del inventario.',
    input_schema: {
      type: 'object',
      properties: {
        estado: { type: 'string', enum: ['en inventario', 'vendido', 'todos'], description: 'Por defecto "todos".' },
        texto: { type: 'string', description: 'Busca en modelo, número de serie y notas.' },
        proveedor: { type: 'string' },
        cliente: { type: 'string' },
        desde: { type: 'string', description: 'YYYY-MM-DD. Filtra por fecha de compra, o de venta si estado="vendido".' },
        hasta: { type: 'string', description: 'YYYY-MM-DD (incluida).' },
      },
    },
  },
  {
    name: 'corregir_reloj',
    description: 'Corrige un dato de un reloj. Si ya está vendido, la ganancia se recalcula sola.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        campo: {
          type: 'string',
          enum: ['modelo', 'numero_serie', 'costo', 'moneda_costo', 'proveedor', 'fecha_compra', 'notas', 'cliente', 'precio_venta', 'moneda_venta', 'fecha_venta', 'tipo_cambio'],
        },
        valor: { type: 'string' },
      },
      required: ['id', 'campo', 'valor'],
    },
  },
  {
    name: 'cancelar_venta_reloj',
    description: 'Deshace una venta registrada por error: el reloj vuelve a estar en inventario.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'borrar_reloj',
    description: 'Elimina por completo un reloj dado de alta por error. Solo si el usuario lo pide explícitamente.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
];

export const INSTRUCCIONES_INVENTARIO = `
INVENTARIO DE RELOJES (pestaña aparte, una fila por pieza con ID tipo R-0001):
- Compra ("compré un Datejust 36 verde a Pedro en 120 mil pesos, serie 7XK92..."): usa registrar_compra_reloj. Necesitas modelo, costo, moneda y a quién se le compró; pide lo que falte. Pide también el número de serie si no lo dieron (si el usuario dice que no lo tiene, regístralo sin serie).
- Venta ("vendí el Datejust verde a Luis en 150 mil"): primero buscar_relojes en inventario para identificar la pieza. Si hay más de una que coincide, pregunta cuál (muestra ID, modelo y serie). Luego registrar_venta_reloj.
- Si la venta es en otra moneda que la compra, PREGUNTA el tipo de cambio (pesos por dólar) antes de registrar. Nunca lo inventes.
- La ganancia la calcula el sistema; repórtala tal como la devuelve la herramienta.
- "120 mil" = 120000; "1.5 millones" = 1500000; "15k" = 15000.
- Una compra de reloj NO es un gasto: no uses registrar_gasto para relojes.
- Al confirmar, menciona el ID del reloj.`;

function siguienteId(relojes) {
  const max = relojes.reduce((m, r) => Math.max(m, Number(String(r.id).replace(/\D/g, '')) || 0), 0);
  return `R-${String(max + 1).padStart(4, '0')}`;
}

// Ganancia en la moneda de venta. tipo_cambio = pesos por 1 dólar.
export function calcularGanancia(r) {
  if (r.estado !== VENDIDO || r.precio_venta == null || r.costo == null) return { ganancia: null, moneda_ganancia: '' };
  if (r.moneda_costo === r.moneda_venta) return { ganancia: r2(r.precio_venta - r.costo), moneda_ganancia: r.moneda_venta };
  const tc = Number(r.tipo_cambio);
  if (!(tc > 0)) return { ganancia: null, moneda_ganancia: '' };
  const costoConvertido = r.moneda_venta === 'MXN' ? r.costo * tc : r.costo / tc;
  return { ganancia: r2(r.precio_venta - costoConvertido), moneda_ganancia: r.moneda_venta };
}

function resumen(lista) {
  const sumar = (items, valor, moneda) => {
    const m = {};
    for (const x of items) {
      const v = x[valor];
      if (v == null || v === '') continue;
      m[x[moneda]] = r2((m[x[moneda]] || 0) + Number(v));
    }
    return m;
  };
  const enStock = lista.filter((r) => r.estado === EN_INVENTARIO);
  const vendidos = lista.filter((r) => r.estado === VENDIDO);
  return {
    piezas_en_inventario: enStock.length,
    inversion_en_inventario: sumar(enStock, 'costo', 'moneda_costo'),
    piezas_vendidas: vendidos.length,
    ventas: sumar(vendidos, 'precio_venta', 'moneda_venta'),
    ganancia: sumar(vendidos, 'ganancia', 'moneda_ganancia'),
    vendidos_sin_ganancia_calculada: vendidos.filter((r) => r.ganancia == null).map((r) => r.id),
  };
}

const vista = (r) => {
  const { fila, ...resto } = r;
  return Object.fromEntries(Object.entries(resto).filter(([, v]) => v !== '' && v != null));
};

function encontrar(relojes, { id, numero_serie }) {
  if (id) return relojes.filter((r) => norm(r.id) === norm(id));
  if (numero_serie) return relojes.filter((r) => r.numero_serie && normSerie(r.numero_serie) === normSerie(numero_serie));
  return [];
}

export async function ejecutarInventario(nombre, input, { inv, persona, ahora }) {
  const hoy = ahora.slice(0, 10);
  const fechaDe = (f) => (esFecha(f) ? f : hoy);
  const relojes = await inv.leerRelojes();

  switch (nombre) {
    case 'registrar_compra_reloj': {
      const costo = Number(input.costo);
      if (!(costo > 0)) return { error: 'Costo inválido' };
      if (!MONEDAS.includes(input.moneda)) return { error: 'Moneda debe ser MXN o USD' };
      if (input.numero_serie) {
        const dup = encontrar(relojes, { numero_serie: input.numero_serie });
        if (dup.length) return { error: 'Ya existe un reloj con ese número de serie', existente: vista(dup[0]) };
      }
      const reloj = {
        id: siguienteId(relojes),
        fecha_compra: fechaDe(input.fecha),
        registro: persona,
        proveedor: input.proveedor || '',
        modelo: input.modelo,
        numero_serie: input.numero_serie || '',
        costo,
        moneda_costo: input.moneda,
        estado: EN_INVENTARIO,
        notas: input.notas || '',
      };
      await inv.agregarReloj(reloj);
      return { ok: true, registrado: vista(reloj), aviso: input.numero_serie ? undefined : 'Registrado sin número de serie.' };
    }

    case 'registrar_venta_reloj': {
      const candidatos = encontrar(relojes, input);
      if (!input.id && !input.numero_serie) return { error: 'Indica el id o número de serie. Usa buscar_relojes primero.' };
      if (candidatos.length === 0) return { error: 'No encontré ese reloj. Usa buscar_relojes.' };
      const r = candidatos[0];
      if (r.estado === VENDIDO) return { error: 'Ese reloj ya está marcado como vendido', reloj: vista(r) };
      const precio = Number(input.precio);
      if (!(precio > 0)) return { error: 'Precio inválido' };
      if (!MONEDAS.includes(input.moneda)) return { error: 'Moneda debe ser MXN o USD' };
      if (input.moneda !== r.moneda_costo && !(Number(input.tipo_cambio) > 0)) {
        return {
          necesita_tipo_cambio: true,
          mensaje: `Se compró en ${r.moneda_costo} y se vende en ${input.moneda}. Pregunta al usuario el tipo de cambio (pesos por dólar) y vuelve a llamar. NO se registró nada todavía.`,
        };
      }
      Object.assign(r, {
        estado: VENDIDO,
        fecha_venta: fechaDe(input.fecha),
        cliente: input.cliente,
        precio_venta: precio,
        moneda_venta: input.moneda,
        tipo_cambio: input.moneda !== r.moneda_costo ? Number(input.tipo_cambio) : null,
        vendio: persona,
        notas: input.notas ? [r.notas, input.notas].filter(Boolean).join(' | ') : r.notas,
      });
      Object.assign(r, calcularGanancia(r));
      await inv.guardarReloj(r);
      return { ok: true, vendido: vista(r) };
    }

    case 'buscar_relojes': {
      const estado = input.estado || 'todos';
      const lista = relojes.filter((r) => {
        if (estado !== 'todos' && r.estado !== estado) return false;
        if (input.texto) {
          const t = norm(input.texto);
          const hay = norm(`${r.id} ${r.modelo} ${r.notas}`).includes(t) || normSerie(r.numero_serie).includes(normSerie(input.texto));
          if (!hay) return false;
        }
        if (input.proveedor && !norm(r.proveedor).includes(norm(input.proveedor))) return false;
        if (input.cliente && !norm(r.cliente).includes(norm(input.cliente))) return false;
        const fecha = estado === VENDIDO ? r.fecha_venta : r.fecha_compra;
        if (input.desde && (fecha || '') < input.desde) return false;
        if (input.hasta && (fecha || '') > input.hasta) return false;
        return true;
      });
      return {
        resumen: resumen(lista),
        relojes: lista.slice(-40).reverse().map(vista),
        nota: lista.length > 40 ? 'Lista recortada a 40; el resumen incluye todos.' : undefined,
      };
    }

    case 'corregir_reloj': {
      const [r] = encontrar(relojes, { id: input.id });
      if (!r) return { error: 'No existe ese ID. Usa buscar_relojes.' };
      const antes = vista(r);
      let valor = input.valor;
      if (['costo', 'precio_venta', 'tipo_cambio'].includes(input.campo)) {
        valor = Number(String(valor).replace(/[$,\s]/g, '').replace(/^US/i, ''));
        if (!(valor > 0)) return { error: 'Número inválido' };
      }
      if (['moneda_costo', 'moneda_venta'].includes(input.campo)) {
        valor = String(valor).toUpperCase();
        if (!MONEDAS.includes(valor)) return { error: 'Moneda debe ser MXN o USD' };
      }
      if (['fecha_compra', 'fecha_venta'].includes(input.campo) && !esFecha(valor)) return { error: 'Fecha YYYY-MM-DD' };
      if (input.campo === 'numero_serie') {
        const dup = encontrar(relojes, { numero_serie: valor }).filter((x) => x.id !== r.id);
        if (dup.length) return { error: 'Ese número de serie ya lo tiene otro reloj', existente: vista(dup[0]) };
      }
      r[input.campo] = valor;
      Object.assign(r, calcularGanancia(r));
      await inv.guardarReloj(r);
      const out = { ok: true, antes, ahora: vista(r) };
      if (r.estado === VENDIDO && r.ganancia == null) out.aviso = 'Monedas distintas sin tipo de cambio: pide el tipo de cambio para calcular la ganancia.';
      return out;
    }

    case 'cancelar_venta_reloj': {
      const [r] = encontrar(relojes, { id: input.id });
      if (!r) return { error: 'No existe ese ID.' };
      if (r.estado !== VENDIDO) return { error: 'Ese reloj no está vendido.' };
      const antes = vista(r);
      Object.assign(r, { estado: EN_INVENTARIO, fecha_venta: '', cliente: '', precio_venta: null, moneda_venta: '', tipo_cambio: null, ganancia: null, moneda_ganancia: '', vendio: '' });
      await inv.guardarReloj(r);
      return { ok: true, antes, ahora: vista(r) };
    }

    case 'borrar_reloj': {
      const [r] = encontrar(relojes, { id: input.id });
      if (!r) return { error: 'No existe ese ID.' };
      await inv.borrarReloj(r);
      return { ok: true, borrado: vista(r) };
    }

    default:
      return null; // no es herramienta de inventario
  }
}
