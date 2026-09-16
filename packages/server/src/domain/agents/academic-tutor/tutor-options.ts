import { Context, Effect, Option } from "effect";

/**
 * Product switches of the tutor. Provided by the composition root from the
 * environment; defaults apply when absent (CLI, evals).
 */
export interface TutorOptions {
  /** `TUTOR_AUTO_DIAGRAM`: the tutor draws a diagram on its own when the topic calls for it. */
  readonly autoDiagram: boolean;
  /** `TUTOR_AUTO_EXPLAIN`: the tutor offers an explanation objective on its own after explaining a topic. */
  readonly autoExplain: boolean;
}

export const defaultTutorOptions: TutorOptions = { autoDiagram: true, autoExplain: false };

export const TutorOptions = Context.Service<TutorOptions>("@proxus/server/agents/academic-tutor/TutorOptions");

export const tutorOptions: Effect.Effect<TutorOptions> = Effect.serviceOption(TutorOptions).pipe(
  Effect.map((options) => Option.isSome(options) ? options.value : defaultTutorOptions)
);
