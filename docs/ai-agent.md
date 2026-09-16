# Tutor AI agent

## Objetivo

El tutor ayuda a estudiar usando materiales locales y creando artefactos de aprendizaje:

- `note`: apunte/explicación.
- `quiz`: ejercicio corto, cerrado y autocorregible.
- `test`: evaluación más completa; puede incluir respuesta corta.
- `diagram`: resumen visual de un tema (proceso o mapa conceptual) con cada concepto anclado a las páginas que lo explican. Se explora en el panel; no se corrige.

## Archivos principales

- `packages/server/src/domain/agents/academic-tutor.ts`
- `packages/server/src/domain/agents/academic-tutor/tutor-chat-service.ts`
- `packages/server/src/domain/agents/harness/session.ts`
- `packages/server/src/infra/agents/gemini-language-model.ts`

Skills:

- `packages/server/src/domain/agents/academic-tutor/skills/use-uploaded-materials.ts`
- `packages/server/src/domain/agents/academic-tutor/skills/create-study-artifacts.ts`
- `packages/server/src/domain/agents/academic-tutor/skills/teach-visually.ts`

Commands:

- `packages/server/src/domain/agents/academic-tutor/material-commands.ts`
- `packages/server/src/domain/agents/academic-tutor/artifact-commands.ts`

Validación de diagramas: `packages/server/src/domain/artifacts/diagram.ts`.

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
artifacts list [note|quiz|test|diagram]
artifacts show <artifactId>
artifacts create '<json>'          # admite source: { materialId, pages }; los diagramas lo exigen
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

El tutor solo puede describir o citar páginas que haya renderizado en la conversación. La skill lo exige y el harness lo comprueba (`harness/grounding.ts`): si la respuesta cita páginas no renderizadas, se descarta, se inyecta un recordatorio de sistema y se repite el paso (una vez). Si la respuesta persiste sin que el modelo haya intentado leer ni haya comprobado que no hay materiales, se emite con un aviso visible al alumno. Límite: solo se detectan citas explícitas de página. Evals: `eval:tutor:grounding` (guardia, sin API) y sus 6 casos en vivo (`GROUNDING_LIVE=1`).

## Diagramas: cuándo dibuja el tutor y qué se valida

La skill `teach-visually` reúne la decisión y las reglas:

- Dibuja cuando el material presenta pasos o fases (`process`, con `cyclic: true` si el último paso vuelve al primero), una evolución o un pipeline por etapas (`timeline` con fases) o conceptos que se relacionan entre sí, incluidas jerarquías (`concept-map` con un concepto raíz y toda arista etiquetada). Las fechas y definiciones sueltas no se dibujan como cajas: van a las tarjetas bajo el diagrama; una pregunta directa o un dato aislado se responde en texto.
- Dibuja el conocimiento, no el documento: los nodos son conceptos, magnitudes, fórmulas, definiciones, pasos o agentes (nunca títulos de sección); cada arista es una proposición legible ("se calcula como", "depende de", "el vapor se enfría en altura"); cada caja lleva una línea de "qué es" (`sublabel`) y un tipo (`kind`), y cada transición del camino principal su causa. Un mapa hecho de "incluye"/"contiene" sin definiciones ni fórmulas se rechaza (`outline-like`).
- Con `TUTOR_AUTO_DIAGRAM=1` (valor por defecto) el tutor crea el diagrama por iniciativa propia al explicar un proceso o una red de conceptos, en el mismo turno y tras leer las páginas. Con `0`, solo lo crea a petición del alumno.
- El modelo describe semántica (nodos con etiqueta, descripción y páginas; aristas con etiqueta; camino principal o raíz). La geometría la calcula la web.

Todo diagrama pasa por `validateDiagram` antes de persistirse: ids únicos, límites de tamaño (`diagramLimits` en `shared`), aristas sobre nodos existentes, cada nodo con 1-6 páginas dentro de `source.pages`, `source.pages` dentro del rango del material y **leídas en la conversación** (el comando consulta las páginas renderizadas del turno, `RenderedPagesRef` en `harness/grounding.ts`), forma coherente por tipo y rechazo de "listas disfrazadas" (estrella con todas las aristas iguales, o proceso con más conceptos sueltos que pasos). Las reglas de contenido: subetiqueta por nodo (si falta se deriva de la primera frase de la descripción), fórmula con expresión, causa en ≥ 80 % de los tramos del camino principal, densidad mínima en mapas (aristas ≥ conceptos − 1 y tres tipos de relación), grupos y vistas sobre nodos existentes, tarjetas obligatorias en mapas y en materiales de ≥ 3 páginas, fases en las líneas de tiempo. Si algo falla, `artifacts create` devuelve al modelo un texto `DIAGRAM_INVALID` con todos los problemas y una pista por cada uno; la skill limita la reparación a dos intentos. El eval `eval:tutor:diagram` cubre validación, normalización, bucle de reparación y etiquetas sin llamar a la API; con `DIAGRAM_LIVE=1` añade seis casos contra el modelo real.

Límite conocido: la validación comprueba estructura y anclaje, no que la descripción de cada nodo sea fiel al PDF; eso se mide en el eval en vivo por cobertura de conceptos del fixture.

## Contexto de la interfaz

La web envía en cada turno qué artefacto tiene abierto el alumno (`context.openArtifactId`, y opcionalmente `openQuestionId` o, en un diagrama, `openNodeId`). El servicio carga el artefacto y añade una nota de sistema solo para ese turno (`academic-tutor/ui-context.ts`), así "explícame la pregunta 2" se entiende sin nombrar el quiz. Al crear un artefacto, el comando devuelve solo una confirmación compacta (id, tipo, título, número de preguntas) y la skill indica responder con un resumen breve sin repetir el contenido: el alumno lo abre desde el panel, donde el chat ofrece un botón "Abrir".

## Trazas en servidor

Cada turno del agente emite líneas de log estructuradas (logger de Effect, el mismo que usa la capa HTTP) con la anotación `agent.turn` compartida por todo el turno y `agent.event` con el tipo de evento:

- `turn.started` / `turn.finished` (pasos, longitud de la respuesta, motivo: `answer` o `max-steps`).
- `model.call` (paso, `agent.durationMs`, tools pedidas, longitud del texto) y `model.error` (mensaje del proveedor, por ejemplo un 429).
- `tool.call` / `tool.failed` (`agent.tool`, `agent.input` resumido, `agent.durationMs`).
- `grounding.retry` / `grounding.flagged` (páginas citadas sin renderizar).

Implementación en `packages/server/src/domain/agents/harness/trace.ts`; el eval `eval:tutor:tool-calls` comprueba que un turno produce estas líneas.

## Configuración

```env
GOOGLE_GENERATIVE_AI_API_KEY=...
GEMINI_MODEL=gemini-3.5-flash
TUTOR_AUTO_DIAGRAM=1
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
