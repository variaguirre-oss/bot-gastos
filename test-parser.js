import { interpretar } from './parser.js';

const casos = [
  '250 comida tacos',
  '$1,200.50 super despensa semanal',
  '85 uber',
  'comida 300 pizza',
  '500',
  '120 farmacia paracetamol',
  'resumen',
  'Borrar',
  'categorías',
  'hola qué tal',
];

for (const c of casos) console.log(c.padEnd(36), '→', JSON.stringify(interpretar(c)));
