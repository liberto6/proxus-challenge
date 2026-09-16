import { useCallback, useEffect, useRef, useState } from "react";
import type { Dictation, DictationStatus } from "./dictation.ts";

/**
 * Dictation through the speech recognition the browser ships (Web Speech
 * API): no key, no server. Chrome and Edge send the audio to Google's
 * service; Safari recognises on the device; Firefox has no implementation.
 * The transcript is the final results so far plus the interim guess of the
 * current sentence, so the text grows while the student speaks.
 */

// The DOM typings of the API vary between TypeScript versions; this is the
// small part used here.
interface RecognitionAlternative {
  readonly transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0: RecognitionAlternative;
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<RecognitionResult>;
}
interface RecognitionErrorEvent {
  readonly error: string;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

const recognitionConstructor = (): (new () => Recognition) | undefined => {
  const scope = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
};

/** What the student reads when recognition fails. */
const describeError = (code: string): string => {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "El navegador no tiene permiso para usar el micrófono. Permítelo en la barra de direcciones y vuelve a grabar, o escribe tu explicación.";
    case "audio-capture":
      return "No se ha encontrado ningún micrófono. Conecta uno o escribe tu explicación.";
    case "no-speech":
      return "No se ha oído nada. Acércate al micrófono y vuelve a grabar.";
    case "network":
      return "El reconocimiento de voz necesita conexión y no ha respondido. Inténtalo de nuevo o escribe tu explicación.";
    case "language-not-supported":
      return "El navegador no reconoce voz en español. Escribe tu explicación.";
    default:
      return `El reconocimiento de voz ha fallado (${code}). Escribe tu explicación.`;
  }
};

export const useSpeechDictation = (onTranscript: (transcript: string) => void): Dictation => {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [seconds, setSeconds] = useState(0);
  const [reason, setReason] = useState<string | undefined>();
  const recognition = useRef<Recognition | undefined>(undefined);
  const clock = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  // Final sentences so far; the interim guess is appended on each result.
  const finals = useRef<string[]>([]);
  const wanted = useRef(false);
  const emit = useRef(onTranscript);
  emit.current = onTranscript;

  const stopClock = useCallback(() => {
    if (clock.current !== undefined) clearInterval(clock.current);
    clock.current = undefined;
  }, []);

  const stop = useCallback(() => {
    wanted.current = false;
    stopClock();
    recognition.current?.stop();
    setStatus((current) => current === "recording" ? "stopped" : current);
  }, [stopClock]);

  const start = useCallback(() => {
    const Ctor = recognitionConstructor();
    if (Ctor === undefined) {
      setReason("Este navegador no reconoce voz. Usa Chrome, Edge o Safari, o escribe tu explicación.");
      setStatus("failed");
      return;
    }
    recognition.current?.abort();
    finals.current = [];
    wanted.current = true;
    setReason(undefined);
    setSeconds(0);
    setStatus("recording");
    emit.current("");
    stopClock();
    clock.current = setInterval(() => setSeconds((current) => current + 1), 1000);

    const instance = new Ctor();
    instance.lang = "es-ES";
    instance.continuous = true;
    instance.interimResults = true;
    instance.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index]!;
        const text = result[0].transcript.trim();
        if (text.length === 0) continue;
        if (result.isFinal) finals.current.push(text);
        else interim = `${interim} ${text}`.trim();
      }
      emit.current([...finals.current, interim].filter((part) => part.length > 0).join(" "));
    };
    instance.onerror = (event) => {
      // "aborted" is our own stop; "no-speech" between sentences is not a failure while recording.
      if (event.error === "aborted") return;
      if (event.error === "no-speech" && finals.current.length > 0) return;
      wanted.current = false;
      stopClock();
      setReason(describeError(event.error));
      setStatus("failed");
    };
    instance.onend = () => {
      // Chrome ends continuous recognition after about a minute or a long silence: resume while the student is still recording.
      if (wanted.current) {
        try {
          instance.start();
        } catch {
          wanted.current = false;
          stopClock();
          setStatus("stopped");
        }
      }
    };
    recognition.current = instance;
    try {
      instance.start();
    } catch (cause) {
      wanted.current = false;
      stopClock();
      setReason(describeError(cause instanceof Error ? cause.name : String(cause)));
      setStatus("failed");
    }
  }, [stopClock]);

  useEffect(() => () => {
    wanted.current = false;
    stopClock();
    recognition.current?.abort();
  }, [stopClock]);

  return { status, seconds, reason, start, stop };
};
