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

## 10. Carpetas: pertenencia en cada elemento y ámbito del tutor en los comandos

- **Contexto.** Materiales, conversaciones y práctica eran colecciones globales: la barra mostraba todo, una conversación nueva no acotaba nada (el tutor listaba todos los PDF en cada turno) y no se podía volver a una conversación anterior.
- **Opciones.** Agrupar solo la práctica por material (no organiza: varios PDF pueden ser un tema); agrupar por conversación (nadie estudia así; los materiales seguirían globales); carpetas con lista de miembros dentro (`materialIds…`, doble contabilidad); carpetas con `folderId` opcional en cada elemento.
- **Decisión.** Carpeta = PDF + conversaciones + práctica. `folderId` opcional en PDF (sidecar), sesión y artefacto: sin migración, lo antiguo cae en General, que es virtual hasta que se renombra y no se borra. El tutor trabaja dentro de la carpeta de la sesión mediante un servicio por turno (`FolderScope`) aplicado en los comandos, no en el prompt; el contrato del chat no cambia. Sin mover ni copiar entre carpetas (decisión de producto: un PDF pertenece a una carpeta; para usarlo en otra se sube de nuevo). Las conversaciones vacías se reutilizan y no cuentan como contenido; borrar una carpeta exige que esté vacía y limpia sus conversaciones vacías.
- **Consecuencias.** Listar una carpeta lee las tres colecciones y filtra (aceptable en ficheros locales). Un PDF copiado a mano siempre aparece en General. Un material de otra carpeta es inaccesible para el tutor aunque el alumno lo mencione. `eval:folders` cubre repositorio y ámbito sin API.

## 7. La regla de capas se verifica, no solo se documenta

- **Contexto.** `docs/architecture.md` describía la regla `transport -> domain <- infra`, pero nada la comprobaba y ya se incumplía en dos sitios (scripts CLI y adapter de Gemini dentro de dominio).
- **Decisión.** Sección "Architecture" en `AGENTS.md` y `scripts/check-architecture.mjs` (`pnpm run check:architecture`) que falla ante imports prohibidos. Los scripts CLI y los evals viven fuera de dominio; el adapter de Gemini en `infra/agents`.
- **Consecuencias.** Un check más en la lista obligatoria. Cero excepciones declaradas.

## 11. Objetivos de explicación: solución oculta en el servidor, corrección determinista y dictado simulado

- **Contexto.** La práctica solo comprobaba reconocimiento (elegir una opción, verdadero o falso) y la única respuesta abierta se corregía por igualdad de texto. No había forma de saber si el alumno era capaz de explicar un tema. Además, los artefactos viajaban completos a la web (un quiz con su `correctOptionId`), así que no existía la noción de contenido oculto al alumno.
- **Opciones.** Dónde vive la solución: (a) enviarla a la web y no mostrarla; (b) proyección en el contrato (`ArtifactView`) que la deja en el servidor. Quién corrige: (c) juez LLM con rúbrica; (d) cobertura determinista de ideas declaradas por el tutor, con sinónimos; (e) ambas, con (d) como respaldo. Entrada por voz: (f) Web Speech API del navegador; (g) servicio o modelo de reconocimiento; (h) dictado simulado con la interfaz de un hook real. Muestras del dictado: (i) fijas para el fixture del repo; (j) generadas en el servidor a partir de las soluciones, para cualquier objetivo.
- **Decisión.** (b), (d), (h) y (j). El tutor crea el objetivo tras leer las páginas (mismo criterio de anclaje que el diagrama: `RenderedPagesRef`, `EXPLAIN_INVALID` con pistas y dos intentos), con título visible y `expected`/`mustMention`/`contradictions` ocultos; el validador rechaza objetivos hechos de títulos de sección. La corrección vive en dominio, no gasta cuota y es evaluable sin API: cada idea se busca por palabras sin acentos tolerando plurales; cubierto / a medias / falta / incorrecto valen 1 / 0,5 / 0 / 0, y `expected` se revela solo en los puntos no cubiertos. La nota de contexto de UI le da al tutor el estado por punto y el último intento para explicar lo que faltó. El dictado es un hook simulado con la forma que tendría uno sobre reconocimiento de voz; las muestras salen de un endpoint de demostración.
- **Consecuencias.** `GET /artifacts/:id` devuelve `ArtifactView` (idéntico a `Artifact` salvo para `explain`), y un eval comprueba que la vista no contiene claves ocultas. La corrección no entiende paráfrasis que no usen ninguna forma declarada; el tutor lo mitiga con sinónimos y el juez LLM queda como siguiente paso con esta corrección de respaldo. El endpoint de muestras expone las soluciones a quien lo llame: es de demo y solo lo usa el modo simulado. `openQuestionId` viaja ahora desde el panel al chat, lo que también sirve a los quizzes.
- **Añadido.** El dictado real existe detrás de `VITE_EXPLAIN_DICTATION=browser`: un segundo hook con la misma interfaz (`Dictation`) sobre la Web Speech API del navegador, sin clave ni servidor; el simulado sigue siendo el valor por defecto porque es determinista para la demo. Ambas fuentes se montan siempre y el panel habla con la configurada; en un navegador sin reconocimiento el micro explica por qué y queda el texto.

## 12. Tutorías entre alumnos: asignatura real en la carpeta, marketplace simulado en la web

- **Contexto.** Se quería una pieza de producto para el discurso de ventas: tutorías entre alumnos de la misma asignatura, fáciles de reservar desde la carpeta. En Proxus una carpeta ya nace con universidad → grado → asignatura, así que toda la oferta puede filtrarse sin que el alumno busque. Pero un marketplace real exige usuarios, pagos y moderación, que el reto excluye expresamente como mejora principal y que no se pueden demostrar en local.
- **Opciones.** (a) Todo real (identidad, reservas y pagos en servidor); (b) todo simulado en la web; (c) asignatura de la carpeta real (contrato, servidor, nota del tutor) y el resto simulado en la web con estado en `localStorage`; (d) solo diseño en la nota final. Moneda: dinero con pasarela simulada, o puntos de la plataforma.
- **Decisión.** (c) y puntos. `FolderSubject` opcional en la carpeta, elegido de un catálogo fixture; `PATCH /folders/:id` acepta `subject` (`null` borra). Tutores, franjas y reseñas se generan por asignatura desde un reparto fijo (`domain/tutoring/fixtures.ts`); reservas, puntos y reseñas escritas viven en el navegador (`store.ts`). Tres puertas a la misma lista (sección de la barra, sugerencia del chat vacío y gancho bajo una nota < 50 %), lista ordenada por coincidencia con la práctica de la carpeta, reserva en una hoja con puntos que se apartan al reservar y se entregan al terminar, reseñas solo de sesiones realizadas. El tutor IA no interviene salvo para ofrecerse a preparar la sesión (prellena el chat). Sin lado «dar tutorías».
- **Consecuencias.** La asignatura da valor por sí sola (la barra la muestra y el tutor IA la ve en su nota de carpeta) y es el enlace con la segmentación real de Proxus. El resto se declara prototipo en la interfaz y en el README; la ordenación «por lo que has fallado» usa los títulos de la práctica de la carpeta, no un registro de conceptos fallados (siguiente paso junto con la memoria de estudio). Convertirlo en producto exige identidad, disponibilidad real, pagos o ledger de puntos y videollamada, fuera de este repo.

## 13. Un resultado de tool nunca es una respuesta

- **Contexto.** Cuando el modelo terminaba un paso sin texto ni tool call (salida gastada en razonamiento, candidato vacío del proveedor) o agotaba los pasos, el harness usaba el último resultado de tool convertido con `String()` como respuesta del tutor. Los comandos devuelven objetos (páginas renderizadas, artefacto creado), así que el alumno leía «[object Object]», y ese mensaje se persistía y contaminaba los turnos siguientes.
- **Opciones.** (a) Serializar el objeto a JSON legible; (b) mensaje fijo «no he podido responder» como mensaje del tutor; (c) reintentar una vez con una nota de sistema y, si sigue vacío, terminar el turno con un evento `error` reintentable sin persistir nada, como ya ocurre con los fallos del proveedor.
- **Decisión.** (c), también al agotar los pasos. El adaptador de Gemini decodifica además `finishReason` y `promptFeedback.blockReason`: una respuesta 200 sin partes útiles por `MAX_TOKENS`, bloqueo o recitación llega como `AiError` explicado en vez de como silencio.
- **Consecuencias.** El historial solo contiene respuestas escritas por el modelo. La web ya trataba `error` con «Reintentar», sin cambios. El reintento cuesta una llamada más al proveedor. Eval `eval:tutor:tool-calls`, caso 5.

## 14. La guardia de anclaje distingue «no leída» de «no existe con esa numeración»

- **Contexto.** Con dos PDF cargados, el tutor citó «páginas 61-95» de un capítulo de 35 páginas sin leerlas en ese turno. La guardia lo detectó, pero el aviso listaba treinta y cinco números y no explicaba nada: el modelo había citado los folios impresos (o sumado las páginas del primer PDF), y el recordatorio solo le pedía «leer esas páginas», que no existen. Además, el patrón de citas no reconocía el plural «páginas N».
- **Opciones.** (a) Solo prompt: pedir citar por posición en el PDF; (b) validar por material, exigiendo que cada cita nombre el material; (c) mantener la comprobación por número, pero conocer los materiales y sus páginas para detectar el fuera de rango, comprimir rangos y explicar la causa probable al modelo y al alumno, más la regla de numeración en prompt y skill.
- **Decisión.** (c). `knownMaterials` lee los materiales de la conversación (`materials list`, `materials view`), `checkCitations` marca las páginas por encima de la longitud de todos ellos, `formatPageList` comprime («61-95»), y recordatorio y aviso cambian de texto en ese caso. El patrón acepta «páginas». (b) queda como siguiente paso: exige un formato de cita con material y cambia el comportamiento del modelo.
- **Consecuencias.** El aviso es útil para el alumno («ningún material tiene tantas páginas: Capítulo 3: 35 páginas») y el reintento tiene una salida real (citar por posición). Sigue sin detectarse una cita a un número válido pero del PDF equivocado. Eval `eval:tutor:grounding`, casos D y E.

## 15. Streaming de tokens por el canal de eventos, sin cambiar el bucle del harness

- **Contexto.** La respuesta aparecía entera al final: el adaptador usaba `generateContent` y el único evento incremental era el progreso de las herramientas. Con turnos de 30-40 s (tres a cinco llamadas al modelo, la última con todo el texto) la espera se hacía larga.
- **Opciones.** (a) Implementar `streamText` de Effect en el adaptador y pasar el bucle del harness a `LanguageModel.streamText`, acumulando partes por paso; (b) mantener `generateText` en el harness y que el adaptador consuma el SSE de Gemini emitiendo `text-delta` por el `AgentEventSink` que el harness ya provee al modelo en cada paso; (c) trocear el texto final en la web con un temporizador (sensación, no latencia).
- **Decisión.** (b). Mismo streaming real de tokens para el alumno con un cambio acotado: el adaptador cambia de endpoint y lee chunks; el harness solo añade `text-reset` cuando el texto de un paso no es la respuesta; la web añade una burbuja borrador. Los evals con modelos guionizados siguen valiendo porque la interfaz del harness con el modelo no cambia. (a) queda como evolución si se quiere exponer el streaming a nivel de Effect (otros consumidores del modelo); (c) se descarta.
- **Consecuencias.** Nuevo par de eventos en el contrato `AgentEvent` (`text-delta`, `text-reset`). Un 429 solo se reintenta antes del primer byte, como antes. El tiempo total del turno no baja: baja el tiempo hasta ver la primera palabra de la respuesta final. Eval `eval:tutor:tool-calls`, casos 6 y 6b.
