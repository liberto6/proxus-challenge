import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Simulated dictation for the prototype: "records" by revealing a given text
 * word by word at speaking pace, with a running clock. It has the shape a
 * hook over `SpeechRecognition` (or a transcription service) would have, so
 * the explanation panel does not change when real speech-to-text lands:
 * `start` opens a recording, `stop` closes it, `transcript` grows while it runs.
 */

export type DictationStatus = "idle" | "recording" | "stopped";

export interface SimulatedDictation {
  readonly status: DictationStatus;
  /** Seconds since the recording started; frozen when it stops. */
  readonly seconds: number;
  /** Starts dictating `text`; the transcript is emitted through `onTranscript` as it grows. */
  readonly start: (text: string) => void;
  readonly stop: () => void;
}

/** Roughly 170 words per minute, with a pause after punctuation. */
const wordDelayMs = 350;
const pauseDelayMs = 420;

export const useSimulatedDictation = (onTranscript: (transcript: string) => void): SimulatedDictation => {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [seconds, setSeconds] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clock = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const emit = useRef(onTranscript);
  emit.current = onTranscript;

  const clear = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    if (clock.current !== undefined) clearInterval(clock.current);
    timer.current = undefined;
    clock.current = undefined;
  }, []);

  const stop = useCallback(() => {
    clear();
    setStatus((current) => current === "recording" ? "stopped" : current);
  }, [clear]);

  const start = useCallback((text: string) => {
    clear();
    const words = text.split(/\s+/).filter((word) => word.length > 0);
    setSeconds(0);
    setStatus("recording");
    emit.current("");
    clock.current = setInterval(() => setSeconds((current) => current + 1), 1000);

    let index = 0;
    const next = () => {
      if (index >= words.length) {
        stop();
        return;
      }
      const word = words[index]!;
      index += 1;
      emit.current(words.slice(0, index).join(" "));
      timer.current = setTimeout(next, /[.,;:!?…]$/.test(word) ? wordDelayMs + pauseDelayMs : wordDelayMs);
    };
    timer.current = setTimeout(next, wordDelayMs);
  }, [clear, stop]);

  useEffect(() => clear, [clear]);

  return { status, seconds, start, stop };
};
