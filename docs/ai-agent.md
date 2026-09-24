# Tutor AI agent

## Objetivo

El tutor ayuda a estudiar usando materiales locales y creando artefactos de aprendizaje:

- `note`: apunte/explicación.
- `quiz`: ejercicio corto, cerrado y autocorregible.
- `test`: evaluación más completa; puede incluir respuesta corta.
- `diagram`: resumen visual de un tema (proceso o mapa conceptual) con cada concepto anclado a las páginas que lo explican. Se explora en el panel; no se corrige.
- `explain`: objetivo de explicación: 3-6 puntos clave que el alumno debe saber explicar con sus palabras, cada uno con una referencia oculta anclada a páginas. El alumno lo explica en el panel (dictado simulado o texto) y se corrige punto por punto.

## Archivos principales

- `packages/server/src/domain/agents/academic-tutor.ts`
- `packages/server/src/domain/agents/academic-tutor/tutor-chat-service.ts`
- `packages/server/src/domain/agents/harness/session.ts`
- `packages/server/src/infra/agents/gemini-language-model.ts`

Skills:

- `packages/server/src/domain/agents/academic-tutor/skills/use-uploaded-materials.ts`
- `packages/server/src/domain/agents/academic-tutor/skills/create-study-artifacts.ts`
- `packages/server/src/domain/agents/academic-tutor/skills/teach-visually.ts`
- `packages/server/src/domain/agents/academic-tutor/skills/assess-explanations.ts`

Commands:

- `packages/server/src/domain/agents/academic-tutor/material-commands.ts`
- `packages/server/src/domain/agents/academic-tutor/artifact-commands.ts`

Validación de diagramas: `packages/server/src/domain/artifacts/diagram.ts`. Validación, corrección y proyección de objetivos de explicación: `packages/server/src/domain/artifacts/explain.ts`.

## Modelo mental

El modelo no recibe acceso directo a todo el backend. El harness le expone tools controladas:

- `load_skill({ name })`: carga instrucciones para una capacidad.
- `cli({ command })`: ejecuta comandos permitidos.

Las skills no son tools. Si Gemini intenta llamar una skill como tool, el adapter redirige esa llamada a `load_skill` cuando puede.

El historial se envía al modelo con partes nativas `tool-call` / `tool-result` (function calling de Gemini), nunca como texto: cuando se renderizaba como texto tipo `Tool call cli: {...}`, el modelo aprendía a responder con ese texto en lugar de llamar a la tool. El eval `eval:tutor:tool-calls` protege este contrato sin llamar a la API.

## Comandos disponibles

Materiales:

```txt
materials list
materials view <materialId> <pages>
```

Artifacts:

```txt
artifacts list [note|quiz|test|diagram|explain]
artifacts show <artifactId>
artifacts create '<json>'          # admite source: { materialId, pages }; diagramas y objetivos de explicación lo exigen
artifacts submit '<json>'
artifacts attempts [artifactId]
artifacts grade <attemptId>
```

`materials view` puede devolver imágenes de páginas para llamadas multimodales a Gemini.

## Flujo de chat

1. La web envía mensajes a `/api/tutor/chat/stream`.
2. El server crea/continúa una sesión del tutor.
3. Gemini responde con texto o function calls.
4. El harness ejecuta tools permitidas y añade resultados a la conversación.
5. La web recibe eventos NDJSON:
   - `{ type: "message", message }`
   - `{ type: "done" }`
6. Si hubo tool results, la web invalida materiales/artifacts.

## Anclaje a las páginas leídas

El tutor solo puede describir o citar páginas que haya renderizado en la conversación. La skill lo exige y el harness lo comprueba (`harness/grounding.ts`): si la respuesta cita páginas no renderizadas, se descarta, se inyecta un recordatorio de sistema y se repite el paso (una vez). Si la respuesta persiste sin que el modelo haya intentado leer ni haya comprobado que no hay materiales, se emite con un aviso visible al alumno. La guardia conoce los materiales de la conversación y sus páginas (a partir de `materials list` y `materials view`): cuando las páginas citadas superan la longitud de todos ellos (el caso típico es citar el folio impreso, «61-95» en un capítulo de 35 páginas, o sumar las páginas de varios PDF), el recordatorio al modelo y el aviso al alumno lo dicen así, con el rango comprimido y el número de páginas de cada material, y la skill y el prompt exigen citar por posición en el PDF y nombrar el material cuando hay varios. Límite: solo se detectan citas explícitas de página, y la comprobación es por número, no por material (una «página 20» del PDF B pasa si se leyó la 20 del PDF A). Evals: `eval:tutor:grounding` (guardia, sin API) y sus 6 casos en vivo (`GROUNDING_LIVE=1`).

## Diagramas: cuándo dibuja el tutor y qué se valida

La skill `teach-visually` reúne la decisión y las reglas:

- Dibuja cuando el material presenta pasos o fases (`process`, con `cyclic: true` si el último paso vuelve al primero), una evolución o un pipeline por etapas (`timeline` con fases) o conceptos que se relacionan entre sí, incluidas jerarquías (`concept-map` con un concepto raíz y toda arista etiquetada). Las fechas y definiciones sueltas no se dibujan como cajas: van a las tarjetas bajo el diagrama; una pregunta directa o un dato aislado se responde en texto.
- Dibuja el conocimiento, no el documento: los nodos son conceptos, magnitudes, fórmulas, definiciones, pasos o agentes (nunca títulos de sección); cada arista es una proposición legible ("se calcula como", "depende de", "el vapor se enfría en altura"); cada caja lleva una línea de "qué es" (`sublabel`) y un tipo (`kind`), y cada transición del camino principal su causa. Un mapa hecho de "incluye"/"contiene" sin definiciones ni fórmulas se rechaza (`outline-like`).
- Con `TUTOR_AUTO_DIAGRAM=1` (valor por defecto) el tutor crea el diagrama por iniciativa propia al explicar un proceso o una red de conceptos, en el mismo turno y tras leer las páginas. Con `0`, solo lo crea a petición del alumno.
- El modelo describe semántica (nodos con etiqueta, descripción y páginas; aristas con etiqueta; camino principal o raíz). La geometría la calcula la web.

Todo diagrama pasa por `validateDiagram` antes de persistirse: ids únicos, límites de tamaño (`diagramLimits` en `shared`), aristas sobre nodos existentes, cada nodo con 1-6 páginas dentro de `source.pages`, `source.pages` dentro del rango del material y **leídas en la conversación** (el comando consulta las páginas renderizadas del turno, `RenderedPagesRef` en `harness/grounding.ts`), forma coherente por tipo y rechazo de "listas disfrazadas" (estrella con todas las aristas iguales, o proceso con más conceptos sueltos que pasos). Las reglas de contenido: subetiqueta por nodo (si falta se deriva de la primera frase de la descripción), fórmula con expresión, causa en ≥ 80 % de los tramos del camino principal, densidad mínima en mapas (aristas ≥ conceptos − 1 y tres tipos de relación), grupos y vistas sobre nodos existentes, tarjetas obligatorias en mapas y en materiales de ≥ 3 páginas, fases en las líneas de tiempo. Si algo falla, `artifacts create` devuelve al modelo un texto `DIAGRAM_INVALID` con todos los problemas y una pista por cada uno; la skill limita la reparación a dos intentos. El eval `eval:tutor:diagram` cubre validación, normalización, bucle de reparación y etiquetas sin llamar a la API; con `DIAGRAM_LIVE=1` añade seis casos contra el modelo real.

Límite conocido: la validación comprueba estructura y anclaje, no que la descripción de cada nodo sea fiel al PDF; eso se mide en el eval en vivo por cobertura de conceptos del fixture.

## Objetivos de explicación: el alumno explica y el sistema corrige

La skill `assess-explanations` fija cuándo y cómo crear un objetivo `explain`:

- Se crea cuando el alumno quiere explicar el tema él mismo ("ponme a prueba", "quiero explicarlo yo") o tras un quiz o un esquema si quiere ir más allá; no para un dato suelto. Con `TUTOR_AUTO_EXPLAIN=1` el tutor lo crea por iniciativa propia tras explicar un proceso o un conjunto de conceptos; con `0` (valor por defecto) solo lo ofrece en una frase y lo crea si el alumno acepta.
- Cada punto clave lleva un título visible (la idea a explicar, nunca un título de sección), una referencia oculta (`expected`, una a tres frases de las páginas leídas), las ideas imprescindibles (`mustMention`, con sinónimos separados por `|`), frases que delatan una idea equivocada (`contradictions`, opcional) y sus páginas.
- La skill prohíbe revelar la referencia o las ideas imprescindibles antes de que el alumno tenga un intento corregido de ese punto; después, la nota de contexto de UI le da al tutor el estado por punto, el comentario y, para el punto abierto, la referencia, para que explique lo que faltó desde las páginas.

Todo objetivo pasa por `validateExplain` antes de persistirse: `source` obligatorio, 3-6 puntos, ids únicos, longitudes (`explainLimits` en `shared`), `expected` distinto del título, 1-3 ideas por punto sin repetirse entre puntos, 1-4 páginas por punto dentro de `source.pages`, del rango del material y **leídas en la conversación** (`RenderedPagesRef`, como el diagrama), y rechazo de objetivos hechos de títulos de sección (`outline-like`). Si algo falla, `artifacts create` devuelve `EXPLAIN_INVALID` con todos los problemas y una pista; la skill limita la reparación a dos intentos.

La corrección es determinista y vive en dominio (`gradeExplain`): cada idea imprescindible se busca en la transcripción por palabras, sin acentos y tolerando plurales; el punto queda `covered` (todas), `partial` (alguna), `missing` (ninguna) o `wrong` (aparece una contradicción), con puntuación 1 / 0,5 / 0 / 0, un comentario, los rangos de texto que activaron cada idea (para resaltar en la web) y la referencia solo cuando el punto no se cubrió. `GET /artifacts/:id` devuelve el objetivo sin los campos ocultos (`ArtifactView`). El eval `eval:tutor:explain` cubre validación, normalización, corrección con transcripciones fijas, muestras de dictado, proyección, el bucle de reparación con un modelo guionizado y la nota de contexto, sin llamar a la API.

Límite conocido: la corrección compara ideas por palabras, no por significado; una buena paráfrasis que no use ninguna de las formas declaradas sale como "falta". El tutor lo mitiga con sinónimos en `mustMention`; un juez con rúbrica queda como siguiente paso, con esta corrección como respaldo.

## Carpetas: el ámbito del tutor

Cada conversación pertenece a una carpeta (General si no se indica). El servicio de chat provee `FolderScope` al turno (`domain/folders/folder.ts`), y los comandos lo aplican en código: `materials list` y `artifacts list` filtran, `materials view` y `artifacts show` rechazan lo que está en otra carpeta sin renderizar nada, `artifacts create` estampa la carpeta. La nota de sistema del turno empieza por `FOLDER: … "Biología" (n material(s))` para que el tutor pueda decir "en esta carpeta" en vez de "no tienes materiales". Sin `FolderScope` (CLI, evals sin carpeta) no se filtra nada. Eval: `eval:folders`.

## Contexto de la interfaz

La web envía en cada turno qué artefacto tiene abierto el alumno (`context.openArtifactId`, y opcionalmente `openQuestionId` o, en un diagrama, `openNodeId`). En un objetivo de explicación, `openQuestionId` es el id del punto clave abierto y el servicio añade además el último intento corregido. El servicio carga el artefacto y añade una nota de sistema solo para ese turno (`academic-tutor/ui-context.ts`), así "explícame la pregunta 2" se entiende sin nombrar el quiz. Al crear un artefacto, el comando devuelve solo una confirmación compacta (id, tipo, título, número de preguntas) y la skill indica responder con un resumen breve sin repetir el contenido: el alumno lo abre desde el panel, donde el chat ofrece un botón "Abrir".

## Trazas en servidor

Cada turno del agente emite líneas de log estructuradas (logger de Effect, el mismo que usa la capa HTTP) con la anotación `agent.turn` compartida por todo el turno y `agent.event` con el tipo de evento:

- `turn.started` / `turn.finished` (pasos, longitud de la respuesta, motivo: `answer`, `max-steps` o `error`).
- `empty-answer.retry` / `empty-answer.failed` (un paso sin texto ni tool call: se pide una vez más una respuesta en texto; si sigue vacío, el turno termina con un error reintentable y no se fabrica ningún mensaje del tutor).
- `model.call` (paso, `agent.durationMs`, tools pedidas, longitud del texto) y `model.error` (mensaje del proveedor, por ejemplo un 429).
- `tool.call` / `tool.failed` (`agent.tool`, `agent.input` resumido, `agent.durationMs`).
- `grounding.retry` / `grounding.flagged` (páginas citadas sin renderizar).

## Streaming de la respuesta

El adaptador de Gemini llama a `streamGenerateContent` (`alt=sse`) y, mientras lee los chunks, emite cada fragmento de texto visible como evento `text-delta` por el mismo canal (`AgentEventSink`) que el progreso de las herramientas; el harness provee ese canal alrededor de cada paso del modelo, así que sin él (CLI, evals) los fragmentos se descartan. Al acabar el chunk final, el adaptador devuelve al harness las mismas partes que devolvía antes (texto unido, llamadas a función con su firma), de modo que el bucle de pasos, la guardia de anclaje y los evals no cambian. El harness emite `text-reset` cuando el texto mostrado no acaba siendo la respuesta: un paso que continúa con tool calls, o un borrador que citaba páginas no leídas. La web acumula los deltas en una burbuja borrador y la sustituye por el `message` del tutor. Los pensamientos del modelo (`thought: true`) no se emiten.

Implementación en `packages/server/src/domain/agents/harness/trace.ts`; el eval `eval:tutor:tool-calls` comprueba que un turno produce estas líneas.

## Configuración

```env
GOOGLE_GENERATIVE_AI_API_KEY=...
GEMINI_MODEL=gemini-3.5-flash
TUTOR_AUTO_DIAGRAM=1
TUTOR_AUTO_EXPLAIN=0
```

## Buenas prácticas al tocar AI

- Haz que una nueva capacidad sea observable: logs, tool results o artefactos claros.
- Limita el set de comandos disponibles; no conviertas el CLI en shell general.
- Escribe prompts/skills que expliquen cuándo usar cada tool.
- Añade smoke tests o evals si el cambio afecta comportamiento del tutor.
- Diseña fallbacks: el modelo puede equivocarse llamando tools o generando JSON.

## Smoke test manual

```bash
pnpm --filter @proxus/server run agent:tutor "list my uploaded materials"
pnpm --filter @proxus/server run agent:tutor "Crea un quiz corto de una pregunta sobre variables cualitativas"
```

Después, abre la web y comprueba que el artifact aparece en la sidebar y puede resolverse.
