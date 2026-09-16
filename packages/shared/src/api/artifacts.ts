import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/unstable/httpapi";
import {
  ArtifactAttempt,
  ArtifactAttemptListResponse,
  ArtifactKind,
  ArtifactListResponse,
  ArtifactView,
  DictationSamplesResponse,
  SubmitAttemptInput
} from "../schemas/artifact.ts";

const ArtifactKindQuery = Schema.Struct({
  kind: Schema.optional(ArtifactKind),
  folderId: Schema.optional(Schema.String)
});

export class ArtifactsApi extends HttpApiGroup.make("artifacts")
  .add(
    HttpApiEndpoint.get("list", "/", {
      query: ArtifactKindQuery,
      success: ArtifactListResponse
    }),
    // The view keeps an explanation objective's solutions on the server.
    HttpApiEndpoint.get("get", "/:id", {
      params: {
        id: Schema.String
      },
      success: ArtifactView
    }),
    HttpApiEndpoint.post("submit", "/:id/submit", {
      params: {
        id: Schema.String
      },
      payload: SubmitAttemptInput,
      success: ArtifactAttempt
    }),
    HttpApiEndpoint.get("listAttempts", "/:id/attempts", {
      params: {
        id: Schema.String
      },
      success: ArtifactAttemptListResponse
    }),
    // Prototype only: transcripts for the simulated dictation of an explanation
    // objective. Built from its solutions, so it is not part of the study flow.
    HttpApiEndpoint.get("dictationSamples", "/:id/dictation-samples", {
      params: {
        id: Schema.String
      },
      success: DictationSamplesResponse,
      error: HttpApiError.NotFound
    })
  )
  .prefix("/artifacts")
{}
