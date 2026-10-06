// Interpreta los mensajes que escriben los usuarios.

export const CATEGORIAS = [
  'comida',
  'super',
  'transporte',
  'gasolina',
  'casa',
  'servicios',
  'salud',
  'entretenimiento',
  'ropa',
  'educacion',
  'mascotas',
  'otros',
];

// Palabras alternativas que se convierten a una categoría.
const ALIAS = {
  restaurante: 'comida',
  comidas: 'comida',
  cena: 'comida',
  desayuno: 'comida',
  supermercado: 'super',
  despensa: 'super',
  uber: 'transporte',
  taxi: 'transporte',
  camion: 'transporte',
  gas: 'gasolina',
  renta: 'casa',
  luz: 'servicios',
  agua: 'servicios',
  internet: 'servicios',
  telefono: 'servicios',
  farmacia: 'salud',
  doctor: 'salud',
  medicina: 'salud',
  cine: 'entretenimiento',
  salidas: 'entretenimiento',
  escuela: 'educacion',
  colegiatura: 'educacion',
  perro: 'mascotas',
  gato: 'mascotas',
  veterinario: 'mascotas',
};

export function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function leerMonto(token) {
  const limpio = token.replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  const valor = Number(limpio);
  return valor > 0 ? valor : null;
}

function leerCategoria(token) {
  const t = normalizar(token);
  if (CATEGORIAS.includes(t)) return t;
  if (ALIAS[t]) return ALIAS[t];
  return null;
}

/**
 * ¿El mensaje está en el formato rápido? ("250 comida tacos", "$85 uber", "comida 300 pizza")
 * Si no, se le pasa a la IA para entender lenguaje natural.
 */
export function esFormatoRapido(mensaje) {
  const texto = (mensaje || '').trim();
  if (!texto || texto.includes('?') || texto.includes('¿')) return false;
  const tokens = texto.split(/\s+/);
  if (tokens.length > 6) return false;
  if (leerMonto(tokens[0]) !== null) return true;
  return tokens.length > 1 && leerCategoria(tokens[0]) !== null && leerMonto(tokens[1]) !== null;
}

/**
 * Devuelve uno de:
 *   { tipo: 'gasto', monto, categoria, descripcion }
 *   { tipo: 'comando', comando }
 *   { tipo: 'desconocido' }
 */
export function interpretar(mensaje) {
  const texto = normalizar(mensaje || '');
  if (!texto) return { tipo: 'desconocido' };

  const comandos = {
    ayuda: 'ayuda',
    help: 'ayuda',
    hola: 'ayuda',
    menu: 'ayuda',
    resumen: 'resumen',
    mes: 'resumen',
    hoy: 'hoy',
    semana: 'semana',
    borrar: 'borrar',
    deshacer: 'borrar',
    categorias: 'categorias',
  };
  if (comandos[texto]) return { tipo: 'comando', comando: comandos[texto] };

  const tokens = mensaje.trim().split(/\s+/);
  const idxMonto = tokens.findIndex((t) => leerMonto(t) !== null);
  if (idxMonto === -1) return { tipo: 'desconocido' };

  const monto = leerMonto(tokens[idxMonto]);
  const resto = tokens.filter((_, i) => i !== idxMonto);

  let categoria = null;
  let idxCategoria = -1;
  for (let i = 0; i < resto.length; i++) {
    const c = leerCategoria(resto[i]);
    if (c) {
      categoria = c;
      idxCategoria = i;
      break;
    }
  }

  // Si la palabra era un alias (ej. "uber"), se conserva en la descripción.
  const palabraCat = idxCategoria >= 0 ? normalizar(resto[idxCategoria]) : null;
  const esAlias = palabraCat && !CATEGORIAS.includes(palabraCat);
  const descripcion = resto
    .filter((_, i) => i !== idxCategoria || esAlias)
    .join(' ')
    .trim();

  return {
    tipo: 'gasto',
    monto,
    categoria: categoria || 'otros',
    descripcion,
  };
}
