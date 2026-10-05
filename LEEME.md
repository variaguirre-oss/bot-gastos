# Bot de gastos por WhatsApp 💰

Registra gastos familiares mandando un WhatsApp como `250 comida tacos`. Todo se guarda en una hoja de Google Sheets.

## Cómo se usa

| Mensaje | Qué hace |
|---|---|
| `250 comida tacos` | Registra $250 en *comida* |
| `85 uber` | Registra $85 en *transporte* (reconoce palabras como uber, luz, farmacia…) |
| `500` | Registra $500 en *otros* |
| `resumen` | Total del mes por categoría y por persona |
| `semana` / `hoy` | Totales de la semana / del día |
| `borrar` | Elimina tu último gasto |
| `categorias` / `ayuda` | Lista de categorías / instrucciones |

Solo responde a los números que pongas en `USERS`.

---

## Puesta en marcha (unos 30–45 minutos)

### 1. Google Sheets
1. Entra a [console.cloud.google.com](https://console.cloud.google.com), crea un proyecto y activa la **Google Sheets API**.
2. Ve a *IAM y administración → Cuentas de servicio → Crear cuenta de servicio*. Luego, en la pestaña *Claves*, crea una clave **JSON** y descárgala.
3. Crea una hoja nueva en Google Sheets y **compártela como Editor** con el correo de la cuenta de servicio (termina en `iam.gserviceaccount.com`).
4. Copia el ID de la hoja: es la parte larga de la URL, entre `/d/` y `/edit`.

### 2. WhatsApp (Meta)
1. Entra a [developers.facebook.com](https://developers.facebook.com), crea una app tipo **Empresa** y agrégale el producto **WhatsApp**.
2. En *WhatsApp → Configuración de la API* copia el **identificador del número de teléfono** y el **token**.
3. Para pruebas, Meta te da un número de prueba; agrega ahí los números de tu familia como destinatarios.
4. El token de prueba dura 24 horas. Para uno permanente, crea un *usuario del sistema* en Meta Business Suite y genera un token con los permisos `whatsapp_business_messaging` y `whatsapp_business_management`.

### 3. Configurar
Copia `.env.example` como `.env` y llena los valores. En `GOOGLE_CREDENTIALS` va el contenido del JSON en una sola línea.

### 4. Subirlo a un servidor (ej. Render)
1. Sube esta carpeta a un repositorio de GitHub (**sin** el archivo `.env`).
2. En [render.com](https://render.com) crea un **Web Service** desde el repositorio: comando de build `npm install`, comando de inicio `npm start`.
3. En *Environment* agrega las mismas variables de tu `.env`.
4. Copia la URL que te da Render (ej. `https://bot-gastos.onrender.com`).

> El plan gratuito de Render se "duerme" tras 15 minutos sin uso y el primer mensaje puede tardar ~1 minuto. Railway o el plan de pago de Render ($7 USD/mes) lo evitan.

### 5. Conectar el webhook
En Meta, *WhatsApp → Configuración → Webhook*:
- **URL de devolución de llamada:** `https://TU-URL/webhook`
- **Token de verificación:** el mismo `VERIFY_TOKEN` de tu `.env`
- Suscríbete al campo **messages**.

Listo: manda `ayuda` al número del bot.

---

## Probar en tu computadora
```bash
npm install
npm test     # prueba cómo se interpretan los mensajes
npm start    # arranca el bot (necesita el .env lleno)
```
Para que Meta llegue a tu computadora usa un túnel como `ngrok http 3000` y pon esa URL en el webhook.

## Personalizar
- **Categorías y palabras clave:** edita `CATEGORIAS` y `ALIAS` en `parser.js`.
- **Agregar a alguien:** añade `numero:nombre` a `USERS` y reinicia.

## Costos
Las conversaciones que inicia el usuario (escribirle al bot) entran como "servicio" y Meta no las cobra por ahora. Google Sheets es gratis. El único costo posible es el servidor.
