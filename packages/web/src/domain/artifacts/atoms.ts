import type { ArtifactKind, SubmitAttemptInput } from "@proxus/shared";
import { Effect } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { ApiClient } from "../../api-client/client.ts";
import { apiRuntime } from "../../lib/runtime.ts";

export const artifactsQuery = apiRuntime
  .atom(
    ApiClient.use((client) =>
      client.artifacts.list({ query: {} })
    ).pipe(Effect.withSpan("artifacts.list", { kind: "client" }))
  )
  .pipe(Atom.keepAlive, Atom.withReactivity(["artifacts"]));

export const artifactsByKindQuery = Atom.family((kind: ArtifactKind) =>
  apiRuntime
    .atom(
      ApiClient.use((client) =>
        client.artifacts.list({ query: { kind } })
      ).pipe(Effect.withSpan("artifacts.listByKind", { kind: "client" }))
    )
    .pipe(Atom.keepAlive, Atom.withReactivity({ artifacts: [kind] }))
);

export const artifactQuery = Atom.family((id: string) =>
  apiRuntime
    .atom(
      ApiClient.use((client) =>
        client.artifacts.get({ params: { id } })
      ).pipe(Effect.withSpan("artifacts.get", { kind: "client" }))
    )
    .pipe(Atom.keepAlive, Atom.withReactivity({ artifacts: [id] }))
);

/** Attempts of one artifact; refreshed when an attempt is submitted (`attempts` key). */
export const artifactAttemptsQuery = Atom.family((id: string) =>
  apiRuntime
    .atom(
      ApiClient.use((client) =>
        client.artifacts.listAttempts({ params: { id } })
      ).pipe(Effect.withSpan("artifacts.listAttempts", { kind: "client" }))
    )
    .pipe(Atom.keepAlive, Atom.withReactivity({ attempts: [id] }))
);

/** Prototype: transcripts for the simulated dictation of an explanation objective. */
export const dictationSamplesQuery = Atom.family((id: string) =>
  apiRuntime
    .atom(
      ApiClient.use((client) =>
        client.artifacts.dictationSamples({ params: { id } })
      ).pipe(Effect.withSpan("artifacts.dictationSamples", { kind: "client" }))
    )
    .pipe(Atom.keepAlive)
);

const submit = (input: SubmitAttemptInput) => {
  // One call per kind so the payload narrows to the member the contract expects.
  switch (input.artifactKind) {
    case "quiz":
      return ApiClient.use((client) => client.artifacts.submit({ params: { id: input.artifactId }, payload: input }));
    case "test":
      return ApiClient.use((client) => client.artifacts.submit({ params: { id: input.artifactId }, payload: input }));
    case "explain":
      return ApiClient.use((client) => client.artifacts.submit({ params: { id: input.artifactId }, payload: input }));
  }
};

export const submitArtifactAttemptAction = apiRuntime.fn(
  (input: SubmitAttemptInput) =>
    submit(input).pipe(Effect.withSpan("artifacts.submit", { kind: "client" })),
  { reactivityKeys: ["artifacts", "attempts"] }
);
