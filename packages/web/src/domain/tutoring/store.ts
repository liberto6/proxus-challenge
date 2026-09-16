import { useSyncExternalStore } from "react";
import type { TutorReview } from "./fixtures.ts";

/**
 * What the prototype remembers about tutoring, in this browser only: the
 * points balance, the sessions booked and the reviews written. There is no
 * server side; the product would keep this per account.
 */

export interface Booking {
  readonly id: string;
  readonly folderId: string;
  readonly tutorId: string;
  readonly tutorName: string;
  readonly subjectName: string;
  readonly slotLabel: string;
  readonly minutes: 30 | 60;
  readonly points: number;
  readonly focus: string;
  /** Artifact ids shared with the tutor. */
  readonly shared: ReadonlyArray<string>;
  readonly status: "upcoming" | "done";
  readonly createdAt: string;
  readonly reviewed?: boolean;
}

export interface TutoringState {
  readonly points: number;
  readonly bookings: ReadonlyArray<Booking>;
  /** Reviews written here, by tutor id. */
  readonly reviews: Readonly<Record<string, ReadonlyArray<TutorReview>>>;
}

export const initialPoints = 120;

const storageKey = "proxus.tutoring.v1";

const initialState: TutoringState = { points: initialPoints, bookings: [], reviews: {} };

const read = (): TutoringState => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return initialState;
    const parsed = JSON.parse(raw) as Partial<TutoringState>;
    return {
      points: typeof parsed.points === "number" ? parsed.points : initialPoints,
      bookings: Array.isArray(parsed.bookings) ? parsed.bookings : [],
      reviews: typeof parsed.reviews === "object" && parsed.reviews !== null ? parsed.reviews : {}
    };
  } catch {
    return initialState;
  }
};

let state: TutoringState = read();
const listeners = new Set<() => void>();

const write = (next: TutoringState) => {
  state = next;
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // Private mode or blocked storage: the state lives for this page load only.
  }
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useTutoringState = (): TutoringState => useSyncExternalStore(subscribe, () => state, () => initialState);

export const book = (input: Omit<Booking, "id" | "status" | "createdAt">): Booking => {
  const booking: Booking = { ...input, id: crypto.randomUUID(), status: "upcoming", createdAt: new Date().toISOString() };
  write({ ...state, points: state.points - input.points, bookings: [booking, ...state.bookings] });
  return booking;
};

/** The prototype has no session clock: the student marks the session as done. */
export const markDone = (bookingId: string) => {
  write({ ...state, bookings: state.bookings.map((booking) => booking.id === bookingId ? { ...booking, status: "done" } : booking) });
};

export const cancel = (bookingId: string) => {
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (booking === undefined || booking.status !== "upcoming") return;
  write({ ...state, points: state.points + booking.points, bookings: state.bookings.filter((item) => item.id !== bookingId) });
};

export const review = (bookingId: string, input: { readonly rating: number; readonly tags: ReadonlyArray<string>; readonly text: string }) => {
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (booking === undefined) return;
  const entry: TutorReview = {
    id: crypto.randomUUID(),
    author: "Tú",
    when: "ahora",
    text: input.text.trim().length === 0 ? "Sin comentario." : input.text.trim(),
    tags: input.tags,
    rating: input.rating,
    own: true
  };
  write({
    ...state,
    bookings: state.bookings.map((item) => item.id === bookingId ? { ...item, reviewed: true } : item),
    reviews: { ...state.reviews, [booking.tutorId]: [entry, ...(state.reviews[booking.tutorId] ?? [])] }
  });
};

/** Forgets everything the prototype stored (a way back to the demo's starting point). */
export const resetTutoring = () => write(initialState);
