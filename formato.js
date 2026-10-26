// Formato visual de las hojas: columnas de dinero con "$" y ganancia en verde/rojo.

const FORMATO_DINERO = { type: 'CURRENCY', pattern: '"$"#,##0.00' };
const color = (hex) => ({
  red: parseInt(hex.slice(1, 3), 16) / 255,
  green: parseInt(hex.slice(3, 5), 16) / 255,
  blue: parseInt(hex.slice(5, 7), 16) / 255,
});
const VERDE = { backgroundColor: color('#d9ead3'), textFormat: { foregroundColor: color('#137333'), bold: true } };
const ROJO = { backgroundColor: color('#f4cccc'), textFormat: { foregroundColor: color('#a50e0e'), bold: true } };

// Columna completa desde la fila 2 (sin límite abajo, así cubre filas nuevas).
const columna = (sheetId, idx) => ({ sheetId, startRowIndex: 1, startColumnIndex: idx, endColumnIndex: idx + 1 });

/**
 * Arma las solicitudes de batchUpdate.
 * dinero: índices de columnas con formato $; semaforo: índice de la columna verde/rojo (o null);
 * reglas: reglas de formato condicional que ya tiene la hoja (para no duplicarlas).
 */
export function construirSolicitudes({ sheetId, dinero = [], semaforo = null, reglas = [] }) {
  const solicitudes = dinero.map((idx) => ({
    repeatCell: {
      range: columna(sheetId, idx),
      cell: { userEnteredFormat: { numberFormat: FORMATO_DINERO } },
      fields: 'userEnteredFormat.numberFormat',
    },
  }));

  if (semaforo !== null) {
    const yaExiste = reglas.some(
      (r) =>
        r.booleanRule?.condition?.type?.startsWith('NUMBER_') &&
        (r.ranges || []).some((g) => (g.startColumnIndex ?? 0) === semaforo && (g.endColumnIndex ?? semaforo + 1) === semaforo + 1)
    );
    if (!yaExiste) {
      const regla = (tipo, formato) => ({
        addConditionalFormatRule: {
          index: 0,
          rule: {
            ranges: [columna(sheetId, semaforo)],
            booleanRule: { condition: { type: tipo, values: [{ userEnteredValue: '0' }] }, format: formato },
          },
        },
      });
      solicitudes.push(regla('NUMBER_GREATER', VERDE), regla('NUMBER_LESS', ROJO));
    }
  }
  return solicitudes;
}

// Nunca detiene el arranque del bot: si falla, solo lo registra.
export async function aplicarFormato(sheets, spreadsheetId, sheetId, opciones) {
  try {
    const info = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets(properties.sheetId,conditionalFormats)',
    });
    const hoja = info.data.sheets.find((s) => s.properties.sheetId === sheetId);
    const requests = construirSolicitudes({ sheetId, reglas: hoja?.conditionalFormats || [], ...opciones });
    if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
    console.log(`Formato aplicado a la hoja ${sheetId} (${requests.length} cambios)`);
  } catch (e) {
    console.error('No se pudo aplicar formato:', e.message);
  }
}
