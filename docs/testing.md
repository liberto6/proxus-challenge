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
# layout del esquema en la web: nodos colocados sin solapes, anillo para ciclos, determinismo, exportación Mermaid
pnpm --filter @proxus/web run check:layout
```

Con API y Poppler, el eval de anclaje añade 6 casos contra el modelo real usando el PDF sintético de `packages/server/fixtures/materials` (unas 20 llamadas; con la cuota gratuita de Gemini el adapter espera y reintenta ante `429`):

```bash
GROUNDING_LIVE=1 pnpm --filter @proxus/server run eval:tutor:grounding
# un subconjunto: GROUNDING_CASES=L1,L4
# otro modelo solo para el eval: GEMINI_MODEL=gemini-3.5-flash-lite
# ver la respuesta cruda de Gemini: GEMINI_DEBUG=1
```

El eval de diagramas añade con `DIAGRAM_LIVE=1` seis casos contra el modelo real (unas 20-25 llamadas): dibuja a petición y por iniciativa propia un proceso de las páginas 1-2, no dibuja una definición suelta ni una lista de fechas, dibuja un mapa conceptual a petición y no inventa material. Cada caso comprueba tipo, cobertura de conceptos del fixture, páginas dentro del rango y leídas, y como mucho dos intentos de creación. Subconjuntos con `DIAGRAM_CASES=D1,D3`.

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

1. `pnpm run dev` y abre `http://localhost:5173`. Debe cargar una sesión (o crearla) y mostrarla en la cabecera.
2. Materiales: sube el PDF desde la barra lateral (aparece con título y páginas); sube un `.txt` renombrado a `.pdf` (error legible, lista sin cambios); borra el subido (confirmación en segundo paso).
3. Lectura anclada: «Explícame las fases del ciclo del agua usando mi material, páginas 1-2, y cita las páginas». Mientras trabaja se ve «Leyendo páginas 1-2 de …»; la respuesta cita solo páginas leídas y no inventa título ni términos.
4. Quiz: «Crea un quiz de 3 preguntas sobre las páginas 1-2». El chat responde con un resumen breve y un botón para abrirlo; no repite las preguntas. El panel muestra «Basado en …, páginas 1-2».
5. Contexto: con el quiz abierto, «Explícame la pregunta 2 sin darme la respuesta». Responde sobre esa pregunta sin pedir el id.
6. Resolver: contesta con un fallo y envía. Puntuación, corrección por pregunta con explicación y reintento.
6b. Esquema: «Explícame las fases del ciclo del agua, páginas 1-2». Sin pedirlo, la timeline muestra «Dibujando un esquema» y el chat una tarjeta «Esquema · 6 conceptos · Abrir». En el panel: anillo de cuatro fases con las relaciones laterales; clic en un concepto → ficha con descripción, chips de página y relaciones; clic en «pág. 1» → vista previa de la página; «Preguntar al tutor» rellena el chat y el turno lleva `openNodeId`; «Lista» muestra la vista de lectura; «SVG» descarga la imagen. Después: «Hazme un esquema con las fechas de la página 3» → el tutor lee la página, explica que una lista de fechas no es un esquema y ofrece nota o quiz. Sin modelo: copia el JSON de `docs/api.md` a `.data/artifacts/artifacts/<id>.json` con un `materialId` existente y abre el panel.
7. Cancelar: lanza una petición larga y pulsa «Cancelar». Aviso de turno cancelado con reintentar; la conversación anterior intacta.
8. Persistencia: recarga la página y reinicia el servidor. La conversación se conserva; el turno cancelado no aparece.
9. Nueva sesión: chat vacío con id distinto; al recargar sigue la nueva.
10. Log del servidor: por turno, líneas `agent.event` `turn.started`, `model.call`, `tool.call`, `turn.finished` con el mismo `agent.turn`.

## Qué reportar en una entrega

- Checks ejecutados y resultado.
- Flujo manual probado.
- Limitaciones conocidas.
- Si no se pudo probar AI por falta de API key, indícalo explícitamente.
