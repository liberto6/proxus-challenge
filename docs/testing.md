# Testing y QA

## Checks automáticos

Desde la raíz:

```bash
pnpm run typecheck
pnpm run check:architecture
pnpm --filter @proxus/web run build
```

Para backend solamente:

```bash
pnpm --filter @proxus/server run typecheck
```

## Evals / smoke tests AI

Sin API (deterministas):

```bash
# protocolo de tool calls entre harness y adapter de Gemini
pnpm --filter @proxus/server run eval:tutor:tool-calls
# guardia de anclaje: el tutor solo cita páginas que ha renderizado
pnpm --filter @proxus/server run eval:tutor:grounding
# sesiones persistidas: historial en servidor, reintento sin duplicados
pnpm --filter @proxus/server run eval:tutor:sessions
# subida y borrado de PDFs sobre un directorio temporal, y render de una página (necesita Poppler)
pnpm --filter @proxus/server run eval:materials
# diagramas: validación, normalización, bucle de reparación con modelo simulado, skill y contexto
pnpm --filter @proxus/server run eval:tutor:diagram
# objetivos de explicación: validación, corrección por cobertura de ideas, muestras de dictado, proyección sin soluciones, bucle de reparación con modelo simulado, skill y contexto
pnpm --filter @proxus/server run eval:tutor:explain
# carpetas: repositorio, pertenencia de PDF/sesiones/artefactos y ámbito del tutor con modelo simulado (necesita Poppler)
pnpm --filter @proxus/server run eval:folders
# layout del esquema en la web: nodos sin solapes, anillo para ciclos, causas sobre el camino, grupos, línea de tiempo, determinismo, exportación Mermaid
pnpm --filter @proxus/web run check:layout
```

Con API y Poppler, el eval de anclaje añade 6 casos contra el modelo real usando el PDF sintético de `packages/server/fixtures/materials` (unas 20 llamadas; con la cuota gratuita de Gemini el adapter espera y reintenta ante `429`):

```bash
GROUNDING_LIVE=1 pnpm --filter @proxus/server run eval:tutor:grounding
# un subconjunto: GROUNDING_CASES=L1,L4
# otro modelo solo para el eval: GEMINI_MODEL=gemini-3.5-flash-lite
# ver la respuesta cruda de Gemini: GEMINI_DEBUG=1
```

El eval de diagramas añade con `DIAGRAM_LIVE=1` siete casos contra el modelo real (unas 25-30 llamadas), con los dos PDF sintéticos de `packages/server/fixtures` (`materials/ciclo-del-agua.pdf` y `materials-timeline/la-bicicleta.pdf`): dibuja a petición y por iniciativa propia un proceso de las páginas 1-2, no dibuja una definición suelta, manda las fechas a una tarjeta, dibuja un mapa conceptual con tarjeta de definiciones, no inventa material y dibuja una línea de tiempo con fases. Cada caso comprueba tipo, cobertura de conceptos del fixture, páginas dentro del rango y leídas, como mucho dos intentos de creación, y anota cuánto contenido puso el modelo (subetiquetas propias, causas en el camino, tarjetas, grupos, vistas). Subconjuntos con `DIAGRAM_CASES=D1,D3`.

```bash
DIAGRAM_LIVE=1 pnpm --filter @proxus/server run eval:tutor:diagram
```

Requieren `.env` con `GOOGLE_GENERATIVE_AI_API_KEY`.

```bash
pnpm --filter @proxus/server run eval:tutor:artifact-authoring
pnpm --filter @proxus/server run agent:tutor "Crea un quiz corto de una pregunta sobre variables cualitativas"
```

## QA manual recomendado

Con un PDF de prueba (`packages/server/fixtures/materials/ciclo-del-agua.pdf`). Cada turno con lectura de páginas consume 3 o 4 peticiones al modelo.

1. `pnpm run dev` y abre `http://localhost:5173`. Debe cargar la carpeta recordada (General la primera vez) con su conversación, y mostrar «Guardada» en la cabecera.
1b. Carpetas: crea «Biología» desde el selector (+): la barra queda vacía («Sube un PDF a esta carpeta») con una conversación nueva; sube el PDF: aparece solo aquí, y al volver a General no está. En Biología, «Explícame las fases…» → el tutor lista solo ese PDF. Pregunta por un PDF de General → responde que está en otra carpeta sin inventar. «Nueva» crea otra conversación en la carpeta; la anterior sigue en la lista y se reabre con sus mensajes; el icono de papelera la borra. Eliminar una carpeta con contenido muestra el motivo («Vacía la carpeta antes de eliminarla: contiene 1 PDF…»); una vacía desaparece y vuelves a General. Recargar mantiene carpeta y conversación.
2. Materiales: sube el PDF desde la barra lateral (aparece con título y páginas); sube un `.txt` renombrado a `.pdf` (error legible, lista sin cambios); borra el subido (confirmación en segundo paso).
3. Lectura anclada: «Explícame las fases del ciclo del agua usando mi material, páginas 1-2, y cita las páginas». Mientras trabaja se ve «Leyendo páginas 1-2 de …»; la respuesta cita solo páginas leídas y no inventa título ni términos.
4. Quiz: «Crea un quiz de 3 preguntas sobre las páginas 1-2». El chat responde con un resumen breve y un botón para abrirlo; no repite las preguntas. El panel muestra «Basado en …, páginas 1-2».
5. Contexto: con el quiz abierto, «Explícame la pregunta 2 sin darme la respuesta». Responde sobre esa pregunta sin pedir el id.
6. Resolver: contesta con un fallo y envía. Puntuación, corrección por pregunta con explicación y reintento.
6b. Esquema: «Explícame las fases del ciclo del agua, páginas 1-3». Sin pedirlo, la timeline muestra «Dibujando un esquema» y el chat una tarjeta «Esquema · N conceptos · Abrir». En el panel: anillo de cuatro fases, cada caja con su línea de "qué es", la causa de cada transición sobre el arco, agentes (Sol, Plantas) con forma de píldora, un grupo «Destinos del agua» alrededor de Recolección, leyenda por tipos, tarjetas «Claves / Definiciones / Fechas» con chips de página, y botones «Ver: …». Clic en un concepto → ficha con tipo, subetiqueta, descripción, páginas y relaciones; clic en «pág. 1» → vista previa; «Preguntar al tutor» rellena el chat y el turno lleva `openNodeId`; «Lista» muestra la vista de lectura; «SVG» y «Mermaid» exportan (grupos y fases como `subgraph`); «Ampliar» (o doble clic en el lienzo) abre el esquema a pantalla completa con la ficha, la leyenda y las tarjetas en una columna lateral, y Esc vuelve al panel conservando selección y zoom. Después: «Hazme un diagrama con las fechas de la página 3» → las fechas acaban en una tarjeta, no en cajas. Con un PDF de evolución («línea de tiempo de …») → bandas de fase. Sin modelo: copia el JSON de `docs/api.md` a `.data/artifacts/artifacts/<id>.json` con un `materialId` existente y abre el panel.
6c. Explicación: «Quiero explicarte yo el ciclo del agua y que me corrijas» → el tutor lee las páginas si hace falta, crea el objetivo y el chat muestra «Explicación · 4 puntos clave · Abrir». En el panel: el enunciado y los títulos de los puntos (nunca lo esperado); elige «a medias» en el selector de simulación y pulsa «Grabar»: ondas, contador y el texto aparece palabra a palabra; «Parar» deja el texto editable; «Corregir» → anillo de nota, cada punto con Cubierto / A medias / Falta / Incorrecto, comentario, «Lo esperado» solo en los no cubiertos, chips de página con vista previa y «Preguntar»; abajo, tu texto con los fragmentos que activaron cada punto subrayados. «Preguntar» en un punto rellena el chat y el turno lleva `openQuestionId`; el tutor explica lo que faltó citando la página. «Repetir» con «buena» → 4/4 y «Antes: …». También puedes escribir en lugar de grabar. Sin modelo: copia el JSON de `docs/api.md` a `.data/artifacts/artifacts/<id>.json` con un `materialId` existente y abre el panel.
7. Cancelar: lanza una petición larga y pulsa «Cancelar». Aviso de turno cancelado con reintentar; la conversación anterior intacta.
8. Persistencia: recarga la página y reinicia el servidor. La conversación se conserva; el turno cancelado no aparece.
9. Nueva sesión: chat vacío con id distinto; al recargar sigue la nueva.
10. Log del servidor: por turno, líneas `agent.event` `turn.started`, `model.call`, `tool.call`, `turn.finished` con el mismo `agent.turn`.

## Qué reportar en una entrega

- Checks ejecutados y resultado.
- Flujo manual probado.
- Limitaciones conocidas.
- Si no se pudo probar AI por falta de API key, indícalo explícitamente.
