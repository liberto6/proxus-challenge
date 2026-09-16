# Decisiones de arquitectura

Registro de las decisiones no obvias tomadas sobre la base del challenge. Cada una con el contexto que la motivó, las opciones consideradas y sus consecuencias.

## 1. Tool calls con partes nativas, no como texto

- **Contexto.** El historial se reenviaba al modelo reescribiendo cada llamada a herramienta como texto (`Tool call cli: {...}`) porque el adapter de Gemini solo entendía partes `text` y `file`. El modelo aprendía ese formato y respondía con el texto en lugar de llamar a la herramienta (3 de 4 turnos en el recorrido inicial).
- **Opciones.** (a) Cambiar el formato del texto para que no lo imite. (b) Partes nativas `tool-call` / `tool-result` de Effect AI y mapeo a `functionCall` / `functionResponse` en el adapter. (c) Sustituir el adapter por una librería oficial.
- **Decisión.** (b). Elimina la causa, es lo que Gemini espera y mantiene el adapter propio, que es pequeño.
- **Consecuencias.** Los mensajes de herramienta llevan `id` (y `metadata` para la firma de pensamiento que exigen los modelos con razonamiento). El eval `eval:tutor:tool-calls` protege el contrato sin llamar a la API.

## 2. Anclaje a páginas verificado en código, no solo en el prompt

- **Contexto.** El tutor describía "las páginas 1 y 2" sin haberlas renderizado, inventando título y contenido, aunque la skill ya decía que las páginas renderizadas son la fuente de verdad.
- **Opciones.** (a) Endurecer la skill. (b) Guardia determinista: si la respuesta cita páginas no renderizadas en la conversación, se descarta, se obliga a leerlas y se responde de nuevo; si persiste sin intentarlo, la respuesta lleva un aviso visible. (c) Un segundo modelo que juzgue cada respuesta.
- **Decisión.** (a) + (b). Barato, determinista y evaluable. (c) queda para evals, no para producción.
- **Consecuencias.** Un reintento extra en el peor caso. Límite conocido: solo detecta citas explícitas de página; una invención sin número de página no se detecta.

## 3. La conversación vive en el servidor

- **Contexto.** El historial se guardaba en memoria del navegador y viajaba entero en cada turno, imágenes incluidas. Se perdía al recargar. El repositorio de sesiones existía pero solo lo usaba el CLI.
- **Opciones.** (a) `localStorage`. (b) Sesiones en servidor con el repositorio existente. (c) Ambas.
- **Decisión.** (b). El cliente envía `sessionId` e `input`; el servidor carga, ejecuta y persiste el turno al completarse. Un turno con error no persiste nada, así que reintentar no duplica.
- **Consecuencias.** Endpoints de sesión; el navegador solo recuerda el id. Sin multiusuario: una sesión es un fichero con un id.

## 4. Eventos tipados en el stream

- **Contexto.** El stream solo distinguía `message` y `done`; la web no podía mostrar progreso ni errores.
- **Decisión.** `AgentEvent` en `shared`: `message`, `progress`, `error` (con `retryable`), `done`. Las herramientas emiten progreso legible a través de un servicio de Effect que el stream provee; los fallos del proveedor se clasifican (cuota diaria, límite por minuto, saturación, clave inválida) y se explican en una frase.
- **Consecuencias.** Cambio de contrato web-servidor. Ante cuota diaria agotada no se reintenta; ante límite por minuto la espera es visible en log y en la web.

## 5. Subida de PDF con multipart de Effect HTTP API, sin librerías nuevas

- **Contexto.** No había forma de añadir materiales sin copiar ficheros a mano.
- **Decisión.** `POST /materials` multipart con validación de cabecera PDF y lectura con Poppler antes de aceptar; escritura en fichero temporal y renombrado atómico. Id derivado del título (slug + sufijo) y título en un sidecar `.meta.json`; los PDFs copiados a mano siguen funcionando.
- **Consecuencias.** Límite de 20 MB. Errores 400 y 404 tipados; el detalle del rechazo va al log.

## 6. Un solo schema de artefactos, con registro de tipos y origen

- **Contexto.** Los schemas de artefactos estaban duplicados en `shared` y en el dominio del servidor; el propio repo lo señalaba como riesgo de drift.
- **Decisión.** `shared` es la fuente; el dominio importa los tipos y aporta solo validación y corrección. `ArtifactByKind` y `CreateArtifactInputByKind` son el registro del que derivan las uniones. Todo artefacto admite `source` (material y páginas) y `createdAt`, opcionales para no invalidar lo ya guardado.
- **Consecuencias.** Añadir un tipo de artefacto es añadir una entrada al registro y su render en la web. El origen permite relacionar práctica con material.

## 7. La regla de capas se verifica, no solo se documenta

- **Contexto.** `docs/architecture.md` describía la regla `transport -> domain <- infra`, pero nada la comprobaba y ya se incumplía en dos sitios (scripts CLI y adapter de Gemini dentro de dominio).
- **Decisión.** Sección "Architecture" en `AGENTS.md` y `scripts/check-architecture.mjs` (`pnpm run check:architecture`) que falla ante imports prohibidos. Los scripts CLI y los evals viven fuera de dominio; el adapter de Gemini en `infra/agents`.
- **Consecuencias.** Un check más en la lista obligatoria. Cero excepciones declaradas.
