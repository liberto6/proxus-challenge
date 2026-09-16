import type { KeyPointCorrection, KeyPointStatus } from "@proxus/shared";

/** A run of the transcript: plain text, or the words that activated a key point. */
export interface TranscriptSegment {
  readonly text: string;
  readonly keyPointId?: string;
  readonly status?: KeyPointStatus;
}

/**
 * Splits the transcript into segments so the words that activated each key
 * point can be underlined with its status colour. Matches are character ranges
 * of the original text; overlapping ranges keep the first one.
 */
export const segmentTranscript = (transcript: string, corrections: ReadonlyArray<KeyPointCorrection>): readonly TranscriptSegment[] => {
  const marks = corrections
    .flatMap((correction) => correction.matches.map((match) => ({ start: match.start, end: match.end, keyPointId: correction.keyPointId, status: correction.status })))
    .filter((mark) => mark.start >= 0 && mark.end <= transcript.length && mark.start < mark.end)
    .sort((a, b) => a.start - b.start);

  const segments: TranscriptSegment[] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start < cursor) continue;
    if (mark.start > cursor) segments.push({ text: transcript.slice(cursor, mark.start) });
    segments.push({ text: transcript.slice(mark.start, mark.end), keyPointId: mark.keyPointId, status: mark.status });
    cursor = mark.end;
  }
  if (cursor < transcript.length) segments.push({ text: transcript.slice(cursor) });
  return segments;
};

export const countWords = (text: string): number => text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
