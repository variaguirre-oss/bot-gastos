// Inventario de relojes (una fila por pieza) en la pestaña "Inventario" de Google Sheets.
import { google } from 'googleapis';

const HOJA = process.env.INVENTARIO_TAB || 'Inventario';

// Orden de columnas en la hoja (A, B, C...).
export const CAMPOS = [
  ['id', 'ID'],
  ['fecha_compra', 'Fecha compra'],
  ['registro', 'Registró'],
  ['proveedor', 'Comprado a'],
  ['modelo', 'Modelo'],
  ['numero_serie', 'No. serie'],
  ['costo', 'Costo'],
  ['moneda_costo', 'Moneda costo'],
  ['estado', 'Estado'],
  ['fecha_venta', 'Fecha venta'],
  ['cliente', 'Vendido a'],
  ['precio_venta', 'Precio venta'],
  ['moneda_venta', 'Moneda venta'],
  ['tipo_cambio', 'Tipo de cambio (MXN por USD)'],
  ['ganancia', 'Ganancia'],
  ['moneda_ganancia', 'Moneda ganancia'],
  ['vendio', 'Vendió'],
  ['notas', 'Notas'],
];
const COL_FIN = String.fromCharCode(64 + CAMPOS.length); // 'R'
const NUMERICOS = new Set(['costo', 'precio_venta', 'tipo_cambio', 'ganancia']);

export const EN_INVENTARIO = 'en inventario';
export const VENDIDO = 'vendido';

let cliente = null;
let sheetIdNumerico = null;
function api() {
  if (cliente) return cliente;
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  cliente = google.sheets({ version: 'v4', auth });
  return cliente;
}
const SPREADSHEET_ID = () => process.env.SPREADSHEET_ID;

export async function prepararInventario() {
  const sheets = api();
  const info = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID() });
  let pestaña = info.data.sheets.find((s) => s.properties.title === HOJA);
  if (!pestaña) {
    const r = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID(),
      requestBody: { requests: [{ addSheet: { properties: { title: HOJA, gridProperties: { frozenRowCount: 1 } } } }] },
    });
    pestaña = { properties: r.data.replies[0].addSheet.properties };
  }
  sheetIdNumerico = pestaña.properties.sheetId;
  const actual = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID(), range: `${HOJA}!A1:${COL_FIN}1` });
  if ((actual.data.values?.[0] || []).length < CAMPOS.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID(),
      range: `${HOJA}!A1:${COL_FIN}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [CAMPOS.map(([, titulo]) => titulo)] },
    });
  }
}

function aFila(reloj) {
  return CAMPOS.map(([k]) => (reloj[k] === undefined || reloj[k] === null ? '' : reloj[k]));
}

export async function leerRelojes() {
  const r = await api().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID(),
    range: `${HOJA}!A2:${COL_FIN}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  return (r.data.values || [])
    .map((f, i) => {
      const reloj = { fila: i + 2 };
      CAMPOS.forEach(([k], j) => {
        const v = f[j];
        reloj[k] = NUMERICOS.has(k) ? (v === '' || v === undefined ? null : Number(v)) : String(v ?? '');
      });
      return reloj;
    })
    .filter((x) => x.id);
}

export async function agregarReloj(reloj) {
  await api().spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID(),
    range: `${HOJA}!A:${COL_FIN}`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [aFila(reloj)] },
  });
}

// Reescribe la fila completa de un reloj.
export async function guardarReloj(reloj) {
  await api().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID(),
    range: `${HOJA}!A${reloj.fila}:${COL_FIN}${reloj.fila}`,
    valueInputOption: 'RAW',
    requestBody: { values: [aFila(reloj)] },
  });
}

export async function borrarReloj(reloj) {
  if (sheetIdNumerico === null) await prepararInventario();
  await api().spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID(),
    requestBody: {
      requests: [
        { deleteDimension: { range: { sheetId: sheetIdNumerico, dimension: 'ROWS', startIndex: reloj.fila - 1, endIndex: reloj.fila } } },
      ],
    },
  });
}
