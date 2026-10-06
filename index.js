// Bot de WhatsApp para control de gastos familiares.
import 'dotenv/config';
import express from 'express';
import { interpretar, esFormatoRapido, CATEGORIAS } from './parser.js';
import { prepararHoja, agregarGasto, leerGastos, borrarFila, actualizarCampo } from './sheets.js';
import { conversar, iaDisponible } from './ai.js';

const {
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  VERIFY_TOKEN,
  USERS = '',
  TIMEZONE = 'America/Mexico_City',
  PORT = 3000,
} = process.env;

// ---------- Usuarios autorizados ----------
// USERS="5218112345678:Ana,5218187654321:Luis"
// Se comparan los últimos 10 dígitos para evitar el problema del "1"
// en números de México (WhatsApp manda 521..., pero se responde a 52...).
const ultimos10 = (n) => String(n).replace(/\D/g, '').slice(-10);
const usuarios = new Map(
  USERS.split(',')
    .map((u) => u.trim())
    .filter(Boolean)
    .map((u) => {
      const [numero, nombre] = u.split(':');
      return [ultimos10(numero), (nombre || numero).trim()];
    })
);

// Números de México: 521XXXXXXXXXX -> 52XXXXXXXXXX para poder responder.
function numeroParaResponder(waId) {
  const n = String(waId);
  if (n.length === 13 && n.startsWith('521')) return '52' + n.slice(3);
  return n;
}

// ---------- Fechas ----------
function ahora() {
  // Formato "2026-10-05 13:41"
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
}
const hoyStr = () => ahora().slice(0, 10);
const mesStr = () => ahora().slice(0, 7);

function inicioSemanaStr() {
  const [y, m, d] = hoyStr().split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  const dia = (fecha.getUTCDay() + 6) % 7; // lunes = 0
  fecha.setUTCDate(fecha.getUTCDate() - dia);
  return fecha.toISOString().slice(0, 10);
}

const dinero = (n, moneda = 'MXN') =>
  (moneda === 'USD' ? 'US$' : '$') +
  n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Suma por moneda: "US$350.12 + $1,200.00"
function totalesPorMoneda(gastos) {
  const m = {};
  for (const g of gastos) m[g.moneda || 'MXN'] = (m[g.moneda || 'MXN'] || 0) + g.monto;
  return Object.entries(m)
    .map(([mon, v]) => dinero(v, mon))
    .join(' + ');
}

// ---------- Respuestas ----------
const AYUDA_BASE = `*Bot de gastos* 💰

*Registro rápido:*
monto categoría descripción
Ej: _250 comida tacos_
Ej: _1200 super despensa semanal_
Ej: _85 uber_
Ej: _61.73 usd labels datejust_ (dólares)

*Comandos:*
• *resumen* – gastos del mes
• *semana* – gastos de esta semana
• *hoy* – gastos de hoy
• *borrar* – elimina tu último gasto
• *categorias* – ver categorías`;

const AYUDA_IA = `

*También puedes escribirme normal* 🤖
Ej: _ayer gasté 480 en el súper_
Ej: _¿cuánto llevamos en comida este mes?_
Ej: _¿quién ha gastado más esta semana?_
Ej: _el último no era comida, era transporte_`;

const ayuda = () => AYUDA_BASE + (iaDisponible() ? AYUDA_IA : '');

function resumir(gastos, titulo) {
  if (gastos.length === 0) return `*${titulo}*\nNo hay gastos registrados.`;

  // Agrupa por clave, sin mezclar monedas.
  const sumar = (clave) => {
    const grupos = new Map();
    for (const g of gastos) {
      if (!grupos.has(g[clave])) grupos.set(g[clave], []);
      grupos.get(g[clave]).push(g);
    }
    return [...grupos.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([k, lista]) => `• ${k}: ${totalesPorMoneda(lista)}`)
      .join('\n');
  };
  const porCategoria = sumar('categoria');
  const porPersona = sumar('persona');

  return `*${titulo}*
Total: *${totalesPorMoneda(gastos)}* (${gastos.length} gastos)

*Por categoría:*
${porCategoria}

*Por persona:*
${porPersona}`;
}

async function responderComando(comando, persona) {
  switch (comando) {
    case 'ayuda':
      return ayuda();
    case 'categorias': {
      const usadas = (await leerGastos()).map((g) => g.categoria).filter(Boolean);
      const todas = [...new Set([...usadas, ...CATEGORIAS])];
      return `*Categorías:*\n${todas.map((c) => `• ${c}`).join('\n')}\n\nPuedes usar cualquier categoría nueva, ej. _300 labels vari_.\nSi no pones categoría, se guarda como _otros_.`;
    }
    case 'hoy': {
      const gastos = (await leerGastos()).filter((g) => g.fecha.startsWith(hoyStr()));
      return resumir(gastos, `Gastos de hoy (${hoyStr()})`);
    }
    case 'semana': {
      const desde = inicioSemanaStr();
      const gastos = (await leerGastos()).filter((g) => g.fecha.slice(0, 10) >= desde);
      return resumir(gastos, `Gastos de la semana (desde ${desde})`);
    }
    case 'resumen': {
      const gastos = (await leerGastos()).filter((g) => g.fecha.startsWith(mesStr()));
      return resumir(gastos, `Gastos del mes (${mesStr()})`);
    }
    case 'borrar': {
      const gastos = await leerGastos();
      const ultimo = [...gastos].reverse().find((g) => g.persona === persona);
      if (!ultimo) return 'No tienes gastos para borrar.';
      await borrarFila(ultimo.fila);
      return `🗑️ Borrado: ${dinero(ultimo.monto, ultimo.moneda)} en ${ultimo.categoria}${
        ultimo.descripcion ? ` (${ultimo.descripcion})` : ''
      }`;
    }
    default:
      return ayuda();
  }
}

async function procesarMensaje(texto, persona) {
  const r = interpretar(texto);

  if (r.tipo === 'comando') return responderComando(r.comando, persona);

  // Todo lo que no sea el formato rápido lo atiende la IA (si está configurada).
  if (iaDisponible() && !(r.tipo === 'gasto' && esFormatoRapido(texto))) {
    try {
      return await conversar(texto, {
        persona,
        ahora: ahora(),
        personas: [...usuarios.values()],
        datos: { leerGastos, agregarGasto, actualizarCampo, borrarFila },
      });
    } catch (err) {
      console.error('Error con la IA:', err?.status, err?.message);
      if (r.tipo !== 'gasto') {
        return 'Ahorita no pude pensar bien 😅. Intenta de nuevo en un momento, o usa el formato rápido: _250 comida tacos_.';
      }
      // Si la IA falla pero parece un gasto, se registra con el método básico.
    }
  }

  if (r.tipo === 'gasto') {
    // Categorías propias (ej. "300 labels vari"): si la primera palabra ya se usó como categoría, se respeta.
    if (r.categoria === 'otros' && r.descripcion) {
      const [primera, ...resto] = r.descripcion.split(/\s+/);
      const usadas = new Set((await leerGastos()).map((g) => String(g.categoria).toLowerCase()));
      if (usadas.has(primera.toLowerCase())) {
        r.categoria = primera.toLowerCase();
        r.descripcion = resto.join(' ');
      }
    }
    await agregarGasto({
      fecha: ahora(),
      persona,
      monto: r.monto,
      categoria: r.categoria,
      descripcion: r.descripcion,
      moneda: r.moneda,
    });
    const gastosMes = (await leerGastos()).filter((g) => g.fecha.startsWith(mesStr()));
    return `✅ Registrado: *${dinero(r.monto, r.moneda)}* en _${r.categoria}_${
      r.descripcion ? ` (${r.descripcion})` : ''
    }\nTotal del mes: ${totalesPorMoneda(gastosMes)}`;
  }

  return 'No entendí 🤔. Escribe por ejemplo _250 comida tacos_, o *ayuda* para ver los comandos.';
}

// ---------- WhatsApp ----------
async function enviarMensaje(para, texto) {
  const res = await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: para,
      type: 'text',
      text: { body: texto },
    }),
  });
  if (!res.ok) console.error('Error al enviar mensaje:', res.status, await res.text());
}

// WhatsApp puede reenviar el mismo mensaje; evitamos registrarlo dos veces.
const procesados = new Set();
function yaProcesado(id) {
  if (procesados.has(id)) return true;
  procesados.add(id);
  if (procesados.size > 1000) procesados.delete(procesados.values().next().value);
  return false;
}

// ---------- Servidor ----------
const app = express();
app.use(express.json());

app.get('/', (_req, res) => res.send('Bot de gastos funcionando ✅'));

// Verificación del webhook (Meta la llama una vez al configurarlo).
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

// Mensajes entrantes.
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // responder rápido a Meta

  try {
    const mensajes = req.body?.entry?.[0]?.changes?.[0]?.value?.messages;
    if (!mensajes) return;

    for (const msg of mensajes) {
      if (yaProcesado(msg.id)) continue;

      const persona = usuarios.get(ultimos10(msg.from));
      const destino = numeroParaResponder(msg.from);

      if (!persona) {
        console.log(`Número no autorizado: ${msg.from}`);
        continue;
      }
      if (msg.type !== 'text') {
        await enviarMensaje(destino, 'Por ahora solo entiendo mensajes de texto. Escribe *ayuda*.');
        continue;
      }

      const respuesta = await procesarMensaje(msg.text.body, persona);
      await enviarMensaje(destino, respuesta);
    }
  } catch (err) {
    console.error('Error procesando el mensaje:', err);
  }
});

prepararHoja()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Bot escuchando en el puerto ${PORT}`);
      console.log(`Usuarios autorizados: ${[...usuarios.values()].join(', ') || '(ninguno)'}`);
      console.log(`IA: ${iaDisponible() ? 'activada' : 'desactivada (falta ANTHROPIC_API_KEY)'}`);
    });
  })
  .catch((err) => {
    console.error('No se pudo conectar con Google Sheets. Revisa SPREADSHEET_ID y GOOGLE_CREDENTIALS.');
    console.error(err.message);
    process.exit(1);
  });
