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

## 8. Diagramas: semántica validada en dominio, geometría en la web, decisión repartida

- **Contexto.** El tutor solo sabía explicar en texto y preguntar. Un resumen visual (proceso, mapa conceptual) ayuda a ver la estructura antes de memorizar, pero todo lo que genera el modelo debe validarse en código, y Mermaid no está realmente disponible: Streamdown trae el componente pero exige el plugin `@streamdown/mermaid`, no instalado.
- **Opciones.** Render: (a) añadir Mermaid (dependencia pesada, salida textual no validable, interacción por nodo difícil); (b) SVG propio con layout por niveles. Contrato: (c) el modelo emite posiciones; (d) solo nodos, aristas, tipo y páginas. Reparación: (e) descartar en silencio; (f) devolver la lista completa de problemas como resultado de la tool; (g) `responseSchema` del proveedor. Cuándo dibujar: (h) el tutor decide y crea; (i) solo a petición.
- **Decisión.** (b), (d), (f) y (h) con interruptor. Un schema `diagram` en `shared` con dos tipos (`process`, `concept-map`; la jerarquía es un mapa con raíz), sin geometría. `validateDiagram` en dominio comprueba ids, aristas, límites, páginas dentro del material y leídas en la conversación (servicio opcional `RenderedPagesRef`, mismo criterio que la guardia de anclaje) y rechaza listas disfrazadas; el comando devuelve `DIAGRAM_INVALID` con pistas y la skill limita a dos intentos. La web calcula el layout (anillo para ciclos, columna, niveles desde la raíz) y dibuja SVG con los tokens del sistema visual; Mermaid queda como exportación. La decisión de dibujar vive en la skill `teach-visually`, en la regla `degenerate-list` del validador y en el eval; `TUTOR_AUTO_DIAGRAM` la desactiva en producción si el coste no compensa.
- **Consecuencias.** Cero dependencias nuevas; `layout.check.ts` y `eval:tutor:diagram` protegen geometría, validación y reparación sin API; el eval en vivo mide cobertura de conceptos en el fixture. Límites: el layout no minimiza cruces (≤ 16 nodos), llamadas paralelas `view` + `create` en un paso se rechazan y se reparan al siguiente, y la fidelidad de cada descripción al PDF no se verifica en código.

## 9. Diagramas v2: el contenido va dentro del schema

- **Contexto.** Con la primera versión, el tutor dibujaba esqueletos: cajas con un nombre, flechas mudas y, en material técnico, el índice del documento. Lo que ahorra leer (qué es cada cosa, por qué ocurre cada paso, la fórmula, la definición, la fecha) no tenía sitio.
- **Opciones.** (a) Pedir descripciones más largas y mostrarlas. (b) Campos estructurados: subetiqueta y tipo por nodo, causa en cada transición (una arista etiquetada entre pasos consecutivos), grupos, tarjetas de texto y vistas guiadas, con reglas de validación nuevas. (c) Markdown libre dentro del nodo.
- **Decisión.** (b). Es lo que se puede validar y dibujar con forma: el validador exige subetiqueta (derivada de la descripción si falta), causa en ≥ 80 % de los tramos, densidad mínima en mapas, rechaza el "mapa del índice" (`outline-like`) y exige tarjetas en mapas y en materiales de tres o más páginas. Fechas y definiciones sueltas dejan de rechazarse: van a tarjetas. Los campos son opcionales en el schema para no invalidar lo guardado. Se añade `timeline` (eje con bandas de fase) porque la fase es semántica propia. Los grupos se dibujan como envolventes tras colocar los nodos (contigüidad por reglas de colocación, no un layout por carriles).
- **Consecuencias.** JSON de 6-10 KB por diagrama y más rechazos al principio, acotados por la derivación de subetiquetas, los ejemplos de la skill (validados por el eval) y el máximo de dos intentos. El eval en vivo anota cuánto contenido pone el modelo (subetiquetas propias, causas, tarjetas). Límites: una envolvente puede quedar grande si el modelo agrupa nodos lejanos; la línea de tiempo es ancha y se lee con zoom o en la vista lista.

## 7. La regla de capas se verifica, no solo se documenta

- **Contexto.** `docs/architecture.md` describía la regla `transport -> domain <- infra`, pero nada la comprobaba y ya se incumplía en dos sitios (scripts CLI y adapter de Gemini dentro de dominio).
- **Decisión.** Sección "Architecture" en `AGENTS.md` y `scripts/check-architecture.mjs` (`pnpm run check:architecture`) que falla ante imports prohibidos. Los scripts CLI y los evals viven fuera de dominio; el adapter de Gemini en `infra/agents`.
- **Consecuencias.** Un check más en la lista obligatoria. Cero excepciones declaradas.
