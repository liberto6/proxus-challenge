import { Effect } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { ApiClient } from "../../api-client/client.ts";
import { apiRuntime } from "../../lib/runtime.ts";

export const materialsQuery = apiRuntime
  .atom(
    ApiClient.use((client) =>
      client.materials.list({ query: {} })
    ).pipe(Effect.withSpan("materials.list", { kind: "client" }))
  )
  .pipe(Atom.keepAlive, Atom.withReactivity(["materials"]));

/** One rendered page of a material, cached per (material, page) while the app lives. */
export const materialPageQuery = Atom.family((key: `${string}:${number}`) => {
  const separator = key.lastIndexOf(":");
  const id = key.slice(0, separator);
  const page = Number(key.slice(separator + 1));
  return apiRuntime
    .atom(
      ApiClient.use((client) =>
        client.materials.getPage({ params: { id, page } })
      ).pipe(Effect.withSpan("materials.getPage", { kind: "client" }))
    )
    .pipe(Atom.keepAlive, Atom.withReactivity({ materials: [id] }));
});

export const materialPageKey = (materialId: string, page: number): `${string}:${number}` => `${materialId}:${page}`;
