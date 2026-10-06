// Lectura y escritura de gastos en Google Sheets.
import { google } from 'googleapis';

const HOJA = process.env.SHEET_TAB || 'Gastos';
const ENCABEZADOS = ['Fecha', 'Persona', 'Monto', 'Categoría', 'Descripción', 'Moneda'];

let cliente = null;
let sheetIdNumerico = null;

function api() {
  if (cliente) return cliente;
  const credenciales = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials: credenciales,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  cliente = google.sheets({ version: 'v4', auth });
  return cliente;
}

const SPREADSHEET_ID = () => process.env.SPREADSHEET_ID;

// Crea la pestaña y los encabezados si todavía no existen.
export async function prepararHoja() {
  const sheets = api();
  const info = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID() });
  let pestaña = info.data.sheets.find((s) => s.properties.title === HOJA);

  if (!pestaña) {
    const r = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID(),
      requestBody: { requests: [{ addSheet: { properties: { title: HOJA } } }] },
    });
    pestaña = { properties: r.data.replies[0].addSheet.properties };
  }
  sheetIdNumerico = pestaña.properties.sheetId;

  const actual = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID(),
    range: `${HOJA}!A1:F1`,
  });
  const fila1 = actual.data.values?.[0] || [];
  // Crea encabezados, o agrega "Moneda" a hojas creadas antes de que existiera.
  if (fila1.length < ENCABEZADOS.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID(),
      range: `${HOJA}!A1:F1`,
      valueInputOption: 'RAW',
      requestBody: { values: [ENCABEZADOS] },
    });
  }
}

export async function agregarGasto({ fecha, persona, monto, categoria, descripcion, moneda = 'MXN' }) {
  await api().spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID(),
    range: `${HOJA}!A:F`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[fecha, persona, monto, categoria, descripcion, moneda]] },
  });
}

// Devuelve todos los gastos con su número de fila (1 = encabezados).
export async function leerGastos() {
  const r = await api().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID(),
    range: `${HOJA}!A2:F`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const filas = r.data.values || [];
  return filas
    .map((f, i) => ({
      fila: i + 2,
      fecha: String(f[0] ?? ''),
      persona: String(f[1] ?? ''),
      monto: Number(f[2]) || 0,
      categoria: String(f[3] ?? 'otros'),
      descripcion: String(f[4] ?? ''),
      moneda: String(f[5] || 'MXN').toUpperCase(),
    }))
    .filter((g) => g.fecha);
}

// Cambia un campo de un gasto existente.
const COLUMNAS = { fecha: 'A', persona: 'B', monto: 'C', categoria: 'D', descripcion: 'E', moneda: 'F' };
export async function actualizarCampo(numeroFila, campo, valor) {
  const col = COLUMNAS[campo];
  if (!col) throw new Error(`Campo desconocido: ${campo}`);
  await api().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID(),
    range: `${HOJA}!${col}${numeroFila}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[valor]] },
  });
}

export async function borrarFila(numeroFila) {
  if (sheetIdNumerico === null) await prepararHoja();
  await api().spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID(),
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheetIdNumerico,
              dimension: 'ROWS',
              startIndex: numeroFila - 1,
              endIndex: numeroFila,
            },
          },
        },
      ],
    },
  });
}
