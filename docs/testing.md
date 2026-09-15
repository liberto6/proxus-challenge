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
# subida y borrado de PDFs sobre un directorio temporal (necesita Poppler)
pnpm --filter @proxus/server run eval:materials
```

Con API y Poppler, el eval de anclaje añade 6 casos contra el modelo real usando el PDF sintético de `packages/server/fixtures/materials` (unas 20 llamadas; con la cuota gratuita de Gemini el adapter espera y reintenta ante `429`):

```bash
GROUNDING_LIVE=1 pnpm --filter @proxus/server run eval:tutor:grounding
# un subconjunto: GROUNDING_CASES=L1,L4
# otro modelo solo para el eval: GEMINI_MODEL=gemini-3.5-flash-lite
# ver la respuesta cruda de Gemini: GEMINI_DEBUG=1
```

Requieren `.env` con `GOOGLE_GENERATIVE_AI_API_KEY`.

```bash
pnpm --filter @proxus/server run eval:tutor:artifact-authoring
pnpm --filter @proxus/server run agent:tutor "Crea un quiz corto de una pregunta sobre variables cualitativas"
```

## QA manual recomendado

1. Arranca app completa:

   ```bash
   pnpm run dev
   ```

2. Abre `http://localhost:5173`.
3. Comprueba que la sidebar lista materiales y artifacts.
4. Pide al tutor crear un quiz.
5. Selecciona el artifact creado.
6. Responde preguntas y envía intento.
7. Verifica:
   - score total,
   - corrección por pregunta,
   - opción `try again`,
   - layout sin workspace cuando no hay artifact seleccionado.

## Qué reportar en una entrega

- Checks ejecutados y resultado.
- Flujo manual probado.
- Limitaciones conocidas.
- Si no se pudo probar AI por falta de API key, indícalo explícitamente.
