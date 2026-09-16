import type { ArtifactSummary, FolderSubject } from "@proxus/shared";
import { useMemo, useState } from "react";
import { describeSubject } from "../domain/tutoring/catalog.ts";
import { reviewTags, tutorsFor, type Tutor, type TutorReview, type TutorSlot } from "../domain/tutoring/fixtures.ts";
import { book, cancel, markDone, review, useTutoringState, type Booking } from "../domain/tutoring/store.ts";
import { kindLabel, Icon, Mascot } from "./icons.tsx";

/**
 * Tutoring between students, scoped to the folder's subject: the list of
 * tutors (ordered by what the student has failed), a profile with reviews,
 * a one-sheet booking paid in points, the confirmation and the review after
 * the session. Tutors, slots and reviews are sample data; bookings and
 * reviews written here live in this browser (see `domain/tutoring/store.ts`).
 */

export interface TutoringPanelProps {
  readonly folderId: string;
  readonly subject: FolderSubject;
  /** Topic the student arrived from (the hook under a failed attempt), if any. */
  readonly topic?: string | undefined;
  /** Practice of the folder: what the student has worked on, and what can be shared with a tutor. */
  readonly practice: ReadonlyArray<ArtifactSummary>;
  readonly onClose: () => void;
  /** Sends text to the chat (the AI tutor prepares the session). */
  readonly onAskTutor: (text: string) => void;
}

type View =
  | { readonly kind: "list" }
  | { readonly kind: "profile"; readonly tutorId: string }
  | { readonly kind: "booking"; readonly tutorId: string; readonly slotId: string }
  | { readonly kind: "confirmed"; readonly bookingId: string };

const avatarTone: Record<Tutor["tone"], string> = { sun: "bg-sun-soft", lila: "bg-lila-soft", mint: "bg-mint-soft" };

const normalize = (text: string) => text.toLocaleLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** A tutor topic matches what the student worked on when they share a meaningful word. */
const topicMatches = (topic: string, weak: ReadonlyArray<string>): boolean => {
  const words = normalize(topic).split(/[^a-z0-9]+/).filter((word) => word.length >= 5);
  return weak.some((item) => {
    const target = normalize(item);
    return target.includes(normalize(topic)) || words.some((word) => target.includes(word));
  });
};

export function TutoringPanel({ folderId, subject, topic, practice, onClose, onAskTutor }: TutoringPanelProps) {
  const [view, setView] = useState<View>({ kind: "list" });
  const state = useTutoringState();
  const tutors = useMemo(() => tutorsFor(subject), [subject]);

  // What the student has failed or worked on: practice titles plus the topic the hook came from.
  const weak = useMemo(
    () => [...new Set([...(topic === undefined ? [] : [topic]), ...practice.filter((item) => item.kind !== "note").map((item) => item.title)])],
    [topic, practice]
  );
  const matchesOf = (tutor: Tutor) => tutor.topics.filter((item) => topicMatches(item, weak));
  const ranked = useMemo(
    () => [...tutors].sort((a, b) => matchesOf(b).length - matchesOf(a).length || b.rating - a.rating),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tutors, weak]
  );
  const recommendedId = ranked[0] !== undefined && matchesOf(ranked[0]).length > 0 ? ranked[0].id : undefined;
  const reviewsOf = (tutor: Tutor): ReadonlyArray<TutorReview> => [...(state.reviews[tutor.id] ?? []), ...tutor.reviews];
  const bookings = state.bookings.filter((booking) => booking.folderId === folderId);

  const header = (title: string, back?: () => void) => (
    <header className="flex h-[60px] items-center gap-2.5 border-ink border-b-2 bg-paper pr-3 pl-4">
      {back !== undefined
        ? <button className="icon-btn text-ink" type="button" onClick={back} aria-label="Volver"><Icon name="back" size={18} /></button>
        : <span className="kind-icon bg-mint-soft text-mint-ink" style={{ width: 30, height: 30 }}><Icon name="people" size={16} /></span>}
      <h2 className="min-w-0 flex-1 truncate font-display font-semibold text-base" title={title}>{title}</h2>
      <button className="icon-btn text-ink" type="button" onClick={onClose} aria-label="Cerrar tutorías"><Icon name="close" size={16} strokeWidth={2.2} /></button>
    </header>
  );

  const tutorById = (id: string) => tutors.find((tutor) => tutor.id === id);

  if (view.kind === "profile") {
    const tutor = tutorById(view.tutorId);
    if (tutor === undefined) { setView({ kind: "list" }); return null; }
    return (
      <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-lila-soft" aria-label="Perfil del tutor">
        {header(tutor.name, () => setView({ kind: "list" }))}
        <TutorProfile
          tutor={tutor}
          matches={matchesOf(tutor)}
          reviews={reviewsOf(tutor)}
          onBook={(slotId) => setView({ kind: "booking", tutorId: tutor.id, slotId })}
        />
      </section>
    );
  }

  if (view.kind === "booking") {
    const tutor = tutorById(view.tutorId);
    const slot = tutor?.slots.find((item) => item.id === view.slotId);
    if (tutor === undefined || slot === undefined) { setView({ kind: "list" }); return null; }
    return (
      <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-lila-soft" aria-label="Reservar tutoría">
        {header(`Reservar con ${tutor.name.split(" ")[0]}`, () => setView({ kind: "profile", tutorId: tutor.id }))}
        <BookingSheet
          tutor={tutor}
          slot={slot}
          subject={subject}
          weak={weak}
          practice={practice}
          points={state.points}
          onChangeSlot={() => setView({ kind: "profile", tutorId: tutor.id })}
          onBooked={(input) => {
            const booking = book({ ...input, folderId, tutorId: tutor.id, tutorName: tutor.name, subjectName: subject.name });
            setView({ kind: "confirmed", bookingId: booking.id });
          }}
        />
      </section>
    );
  }

  if (view.kind === "confirmed") {
    const booking = bookings.find((item) => item.id === view.bookingId);
    if (booking === undefined) { setView({ kind: "list" }); return null; }
    return (
      <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-lila-soft" aria-label="Reserva confirmada">
        {header(`Tutorías · ${subject.name}`)}
        <Confirmed booking={booking} onAskTutor={onAskTutor} onBack={() => setView({ kind: "list" })} />
      </section>
    );
  }

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-lila-soft" aria-label="Tutorías">
      {header(`Tutorías · ${subject.name}`)}
      <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto p-5">
        <div className="flex flex-wrap items-center gap-2 font-bold text-ink-muted text-sm">
          <span className="badge badge-lila">{describeSubject(subject)}</span>
          <span>{tutors.length} tutores de tu grado · tienes <strong className="text-ink">{state.points} puntos</strong></span>
        </div>

        {bookings.filter((booking) => booking.status === "upcoming").map((booking) => (
          <UpcomingCard key={booking.id} booking={booking} onOpen={() => setView({ kind: "confirmed", bookingId: booking.id })} />
        ))}
        {bookings.filter((booking) => booking.status === "done" && booking.reviewed !== true).map((booking) => (
          <ReviewCard key={booking.id} booking={booking} />
        ))}

        {weak.length > 0 && (
          <p className="font-semibold text-ink-subtle text-xs">
            Ordenados por lo que has trabajado: {weak.slice(0, 3).map((item, index) => <strong key={index} className="text-ink-muted">{index > 0 ? ", " : ""}{item}</strong>)}.
          </p>
        )}

        {ranked.map((tutor) => (
          <TutorCard
            key={tutor.id}
            tutor={tutor}
            matches={matchesOf(tutor)}
            reviewCount={reviewsOf(tutor).length + tutor.reviewCount - tutor.reviews.length}
            recommended={tutor.id === recommendedId}
            onProfile={() => setView({ kind: "profile", tutorId: tutor.id })}
            onBook={() => {
              const slot = tutor.slots.find((item) => item.taken !== true);
              if (slot !== undefined) setView({ kind: "booking", tutorId: tutor.id, slotId: slot.id });
            }}
          />
        ))}
      </div>
      <footer className="border-ink border-t-2 bg-paper px-5 py-2.5 font-semibold text-ink-subtle text-xs">
        Prototipo: tutores, franjas y reseñas son datos de ejemplo; las reservas y los puntos se guardan solo en este navegador.
      </footer>
    </section>
  );
}

// --- Piezas ------------------------------------------------------------------------

function Avatar({ tutor, size = 44 }: { readonly tutor: Tutor; readonly size?: number }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full border-2 border-ink font-display font-semibold ${avatarTone[tutor.tone]}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {tutor.initial}
    </span>
  );
}

function Stars({ value, size = 14 }: { readonly value: number; readonly size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 align-[-2px] text-sun-ink" aria-label={`${value} de 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} width={size} height={size} viewBox="0 0 24 24" fill={n <= Math.round(value) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" />
        </svg>
      ))}
    </span>
  );
}

const Verified = () => (
  <span className="inline-grid size-4 place-items-center rounded-full bg-mint text-white" title="Verificado por la universidad" aria-label="Verificado por la universidad">
    <Icon name="check" size={10} strokeWidth={3} />
  </span>
);

function TopicChips({ topics, matches }: { readonly topics: ReadonlyArray<string>; readonly matches: ReadonlyArray<string> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {topics.map((topicName) => (
        <span key={topicName} className={`badge ${matches.includes(topicName) ? "badge-sun" : "badge-lila"}`} style={{ borderColor: matches.includes(topicName) ? undefined : "var(--color-lila-soft)" }}>
          {topicName}
        </span>
      ))}
    </div>
  );
}

function SlotChip({ slot, selected, onClick }: { readonly slot: TutorSlot; readonly selected?: boolean; readonly onClick?: (() => void) | undefined }) {
  const base = "inline-flex h-7 items-center gap-1.5 rounded-full border-2 px-2.5 font-extrabold text-xs whitespace-nowrap";
  if (slot.taken === true) return <span className={`${base} border-line text-ink-subtle line-through`}>{slot.label}</span>;
  const tone = selected ? "border-ink bg-sun-soft text-ink" : "border-line bg-paper text-ink-muted hover:border-ink";
  return onClick === undefined
    ? <span className={`${base} ${tone}`}><Icon name="clock" size={12} /> {slot.label}</span>
    : <button type="button" className={`${base} ${tone}`} onClick={onClick} aria-pressed={selected}><Icon name="clock" size={12} /> {slot.label}</button>;
}

function TutorCard({ tutor, matches, reviewCount, recommended, onProfile, onBook }: {
  readonly tutor: Tutor;
  readonly matches: ReadonlyArray<string>;
  readonly reviewCount: number;
  readonly recommended: boolean;
  readonly onProfile: () => void;
  readonly onBook: () => void;
}) {
  return (
    <article className="card flex flex-col gap-2.5 p-3.5">
      <div className="flex items-start gap-3">
        <Avatar tutor={tutor} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 font-extrabold text-[15px] leading-tight">
            {tutor.name} <Verified />
            {recommended && <span className="badge badge-sun sticker ml-1" style={{ height: 22, fontSize: 11 }}>Recomendada para ti</span>}
          </div>
          <p className="font-semibold text-ink-muted text-[13px]">{tutor.meta} · {tutor.grade}</p>
          <p className="font-semibold text-ink-muted text-[13px]"><Stars value={tutor.rating} /> <strong className="text-ink">{tutor.rating.toFixed(1).replace(".", ",")}</strong> · {reviewCount} reseñas · {tutor.replyTime}</p>
        </div>
        <div className="shrink-0 text-right font-display font-semibold text-base leading-tight">
          {tutor.price30} pts<br /><span className="font-sans font-bold text-ink-muted text-xs">30 min</span>
        </div>
      </div>
      <TopicChips topics={tutor.topics} matches={matches} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">{tutor.slots.slice(0, 3).map((slot) => <SlotChip key={slot.id} slot={slot} />)}</div>
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm" type="button" onClick={onProfile}>Ver perfil</button>
          <button className="btn btn-primary btn-sm" type="button" onClick={onBook}>Reservar</button>
        </div>
      </div>
    </article>
  );
}

function TutorProfile({ tutor, matches, reviews, onBook }: {
  readonly tutor: Tutor;
  readonly matches: ReadonlyArray<string>;
  readonly reviews: ReadonlyArray<TutorReview>;
  readonly onBook: (slotId: string) => void;
}) {
  const [slotId, setSlotId] = useState<string | undefined>(tutor.slots.find((slot) => slot.taken !== true)?.id);
  const slot = tutor.slots.find((item) => item.id === slotId);
  return (
    <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
      <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto p-5">
        <article className="card flex flex-col gap-2.5 p-4">
          <div className="flex items-start gap-3">
            <Avatar tutor={tutor} size={64} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 font-extrabold text-lg leading-tight">{tutor.name} <Verified /></div>
              <p className="font-semibold text-ink-muted text-[13px]">{tutor.meta} · verificado por la universidad</p>
              <p className="mt-1 font-semibold text-ink-muted text-[13px]"><Stars value={tutor.rating} /> <strong className="text-ink">{tutor.rating.toFixed(1).replace(".", ",")}</strong> · {reviews.length + tutor.reviewCount - tutor.reviews.length} reseñas · {tutor.sessions} sesiones</p>
            </div>
          </div>
          <p className="font-semibold text-sm">{tutor.grade}. {tutor.bio}</p>
          <TopicChips topics={tutor.topics} matches={matches} />
        </article>

        <section className="card flex flex-col gap-2.5 p-4" style={{ boxShadow: "none" }} aria-label="Franjas">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-sm">Esta semana</strong>
            <span className="font-display font-semibold text-base">{tutor.price30} pts <span className="font-sans font-bold text-ink-muted text-xs">/ 30 min</span> · {tutor.price60} pts <span className="font-sans font-bold text-ink-muted text-xs">/ 60 min</span></span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tutor.slots.map((item) => <SlotChip key={item.id} slot={item} selected={item.id === slotId} onClick={item.taken === true ? undefined : () => setSlotId(item.id)} />)}
          </div>
          <p className="font-semibold text-ink-subtle text-xs">Videollamada dentro de Proxus · cancelación gratis hasta 12 h antes · los puntos se entregan al terminar la sesión.</p>
        </section>

        <section className="flex flex-col gap-2" aria-label="Reseñas">
          <strong className="text-sm">Reseñas de alumnos de la asignatura</strong>
          {reviews.map((item) => (
            <article key={item.id} className={`card-flat flex flex-col gap-1.5 p-3 ${item.own === true ? "bg-sun-soft" : ""}`}>
              <div className="flex items-center justify-between gap-2 font-extrabold text-[13px]">
                <span>{item.author} · <Stars value={item.rating} size={12} /></span>
                <span className="font-semibold text-ink-subtle text-xs">{item.when}</span>
              </div>
              <p className="font-semibold text-ink-muted text-[13px]">{item.text}</p>
              <div className="flex flex-wrap gap-1.5">
                {item.tags.map((tag) => <span key={tag} className="badge badge-neutral" style={{ height: 22, fontSize: 11 }}>{tag}</span>)}
                <span className="badge" style={{ height: 22, fontSize: 11, background: "var(--color-mint-soft)", color: "var(--color-mint-ink)", borderColor: "var(--color-mint-soft)" }}><Icon name="check" size={11} strokeWidth={3} /> sesión verificada</span>
              </div>
            </article>
          ))}
        </section>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-ink border-t-2 bg-paper px-5 py-3">
        <span className="font-semibold text-ink-subtle text-xs">{slot === undefined ? "Elige una franja" : `Seleccionado: ${slot.label} · 30 min`}</span>
        <button className="btn btn-primary" type="button" disabled={slot === undefined} onClick={() => { if (slotId !== undefined) onBook(slotId); }}>Reservar por {tutor.price30} puntos</button>
      </footer>
    </div>
  );
}

function BookingSheet({ tutor, slot, subject, weak, practice, points, onChangeSlot, onBooked }: {
  readonly tutor: Tutor;
  readonly slot: TutorSlot;
  readonly subject: FolderSubject;
  readonly weak: ReadonlyArray<string>;
  readonly practice: ReadonlyArray<ArtifactSummary>;
  readonly points: number;
  readonly onChangeSlot: () => void;
  readonly onBooked: (input: { readonly slotLabel: string; readonly minutes: 30 | 60; readonly points: number; readonly focus: string; readonly shared: ReadonlyArray<string> }) => void;
}) {
  const [minutes, setMinutes] = useState<30 | 60>(30);
  const [focus, setFocus] = useState(() => `${subject.name}${weak.length > 0 ? ` · ${weak.slice(0, 2).join(" y ")}` : ""}`);
  const sharable = practice.filter((item) => item.kind !== "note").slice(0, 3);
  const [shared, setShared] = useState<ReadonlyArray<string>>(sharable.slice(0, 1).map((item) => item.id));
  const cost = minutes === 30 ? tutor.price30 : tutor.price60;
  const enough = points >= cost;
  const toggle = (id: string) => setShared((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  return (
    <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto p-5">
      <div className="card flex flex-col gap-3.5 p-4 shadow-hard-lg">
        <div className="flex items-center gap-3">
          <Avatar tutor={tutor} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 font-extrabold text-[15px]">{tutor.name} <Verified /></div>
            <p className="font-semibold text-ink-muted text-[13px]">{slot.label} · {minutes} min · videollamada dentro de Proxus</p>
          </div>
          <button className="btn btn-secondary btn-sm" type="button" onClick={onChangeSlot}>Cambiar hora</button>
        </div>

        <div className="segmented self-start" role="radiogroup" aria-label="Duración">
          {([30, 60] as const).map((option) => (
            <button key={option} type="button" role="radio" aria-checked={minutes === option} className={minutes === option ? "segmented-on" : ""} onClick={() => setMinutes(option)}>
              {option} min · {option === 30 ? tutor.price30 : tutor.price60} pts
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="font-extrabold text-ink-muted text-xs uppercase tracking-wider">¿Qué quieres trabajar?</span>
          <textarea
            className="min-h-20 w-full rounded-sm border-2 border-ink bg-paper p-3 font-semibold text-sm leading-relaxed outline-none"
            value={focus}
            onChange={(event) => setFocus(event.currentTarget.value)}
          />
          <span className="font-semibold text-ink-subtle text-xs">Rellenado con lo que has trabajado en esta carpeta. Puedes editarlo.</span>
        </label>

        {sharable.length > 0 && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 font-extrabold text-ink-muted text-xs uppercase tracking-wider">Compartir con {tutor.name.split(" ")[0]}</legend>
            {sharable.map((item) => (
              <label key={item.id} className="flex items-start gap-2.5 font-semibold text-sm">
                <input type="checkbox" className="mt-1 size-4 accent-[var(--color-sun)]" checked={shared.includes(item.id)} onChange={() => toggle(item.id)} />
                <span>{kindLabel[item.kind]} «{item.title}»{item.source === undefined ? "" : ` y sus páginas`}</span>
              </label>
            ))}
          </fieldset>
        )}

        <div className="flex items-center justify-between gap-3 rounded-md border-2 border-ink bg-sun-soft px-3.5 py-3">
          <div><div className="font-extrabold text-sun-ink text-xs uppercase tracking-wider">Coste</div><div className="font-display font-semibold text-[22px] leading-tight">{cost} puntos</div></div>
          <div className="text-right"><div className="font-extrabold text-sun-ink text-xs uppercase tracking-wider">Tienes</div><div className={`font-display font-semibold text-[22px] leading-tight ${enough ? "" : "text-rosa-ink"}`}>{points} → {points - cost}</div></div>
        </div>
        <p className="font-semibold text-ink-subtle text-xs">Los puntos se apartan ahora y se entregan a {tutor.name.split(" ")[0]} cuando termina la sesión. Si cancelas con más de 12 h, vuelven a tu cuenta.</p>
        {!enough && <p className="rounded-md border-2 border-rosa bg-rosa-soft p-2.5 font-semibold text-rosa-ink text-sm" role="alert">No tienes puntos suficientes. Los ganas cuando otros alumnos usan tus apuntes y tus quizzes.</p>}

        <button className="btn btn-primary h-11" type="button" disabled={!enough || focus.trim().length === 0} onClick={() => onBooked({ slotLabel: slot.label, minutes, points: cost, focus: focus.trim(), shared })}>
          Reservar por {cost} puntos
        </button>
      </div>
      <p className="text-center font-semibold text-ink-subtle text-xs">Ganas puntos cuando otros alumnos usan tus apuntes y tus quizzes.</p>
    </div>
  );
}

function Confirmed({ booking, onAskTutor, onBack }: { readonly booking: Booking; readonly onAskTutor: (text: string) => void; readonly onBack: () => void }) {
  return (
    <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto p-5">
      <section className="card relative flex items-center gap-4 overflow-hidden p-4 shadow-hard-lg" role="status" aria-live="polite">
        <span className="confetti" style={{ width: 8, height: 8, background: "#ff6b4a", top: 10, right: 60, transform: "rotate(20deg)" }} />
        <span className="confetti" style={{ width: 6, height: 10, background: "#ffc94d", top: 26, right: 34, transform: "rotate(-30deg)" }} />
        <span className="confetti" style={{ width: 7, height: 7, background: "#8b7cf6", bottom: 14, right: 80, transform: "rotate(45deg)" }} />
        <div className="ring" style={{ background: "conic-gradient(#2fbf8a 0 100%)" }} aria-hidden="true"><div className="text-mint-ink"><Icon name="check" size={26} strokeWidth={3} /></div></div>
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold text-xl leading-tight">{booking.status === "done" ? "Sesión realizada" : "Reserva confirmada"}</p>
          <p className="font-semibold text-ink-muted text-sm">{booking.slotLabel} con {booking.tutorName} · {booking.minutes} min · {booking.points} puntos {booking.status === "done" ? "entregados" : "apartados"}</p>
        </div>
      </section>
      <section className="card flex flex-col gap-2.5 p-4" style={{ boxShadow: "none" }}>
        <p className="font-semibold text-sm"><Icon name="check" size={14} strokeWidth={3} className="mr-1.5 inline text-mint-ink" />{booking.tutorName.split(" ")[0]} ya tiene lo que compartiste{booking.shared.length > 0 ? ` (${booking.shared.length})` : ""} y tu nota: «{booking.focus}».</p>
        <p className="font-semibold text-sm"><Icon name="check" size={14} strokeWidth={3} className="mr-1.5 inline text-mint-ink" />Te avisamos 10 minutos antes. El enlace se activa a la hora.</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <button className="btn btn-secondary btn-sm" type="button" disabled title="Se activa a la hora de la sesión"><Icon name="video" size={14} /> Entrar a la sesión</button>
          <button className="btn btn-secondary btn-sm" type="button"><Icon name="calendar" size={14} /> Añadir al calendario</button>
          {booking.status === "upcoming" && (
            <>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => markDone(booking.id)}>Marcar como realizada</button>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => { cancel(booking.id); onBack(); }}>Cancelar reserva</button>
            </>
          )}
        </div>
      </section>
      {booking.status === "upcoming" && (
        <div className="flex items-center gap-2.5 rounded-md border-2 border-ink border-dashed bg-paper px-3 py-2.5 font-bold text-[13px]">
          <Mascot size={30} className="shrink-0" />
          <span>Mientras tanto, si quieres, repasamos juntos «{booking.focus}» para que llegues con preguntas concretas. <button className="font-extrabold text-lila-ink underline" type="button" onClick={() => onAskTutor(`Tengo una tutoría con ${booking.tutorName.split(" ")[0]} ${booking.slotLabel.toLocaleLowerCase()} sobre «${booking.focus}». Ayúdame a prepararla: ¿qué debería tener claro y qué preguntas concretas llevar?`)}>Vamos</button></span>
        </div>
      )}
      {booking.status === "done" && booking.reviewed !== true && <ReviewCard booking={booking} />}
      <button className="btn btn-ghost btn-sm self-start" type="button" onClick={onBack}>Volver a los tutores</button>
    </div>
  );
}

function UpcomingCard({ booking, onOpen }: { readonly booking: Booking; readonly onOpen: () => void }) {
  return (
    <button className="card flex items-center gap-3 bg-mint-soft p-3.5 text-left" type="button" onClick={onOpen}>
      <span className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-ink bg-paper font-display font-semibold text-lg" aria-hidden="true">{booking.tutorName[0]}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-extrabold text-sm">{booking.slotLabel} · {booking.tutorName}</span>
        <span className="block font-semibold text-ink-muted text-[13px]">{booking.focus} · {booking.minutes} min</span>
      </span>
      <Icon name="chevron" size={16} className="shrink-0 text-ink" />
    </button>
  );
}

function ReviewCard({ booking }: { readonly booking: Booking }) {
  const [rating, setRating] = useState(5);
  const [tags, setTags] = useState<ReadonlyArray<string>>([]);
  const [text, setText] = useState("");
  const toggle = (tag: string) => setTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
  return (
    <section className="card flex flex-col gap-3 p-4 shadow-hard-lg" aria-label="Reseña de la tutoría">
      <div>
        <p className="font-display font-semibold text-lg leading-tight">¿Qué tal con {booking.tutorName.split(" ")[0]}?</p>
        <p className="font-semibold text-ink-muted text-[13px]">{booking.slotLabel} · {booking.minutes} min · {booking.points} puntos entregados</p>
      </div>
      <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Valoración">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} className="text-sun-ink" onClick={() => setRating(n)} aria-label={`${n} estrellas`}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill={n <= rating ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" /></svg>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {reviewTags.map((tag) => (
          <button key={tag} type="button" className={`badge ${tags.includes(tag) ? "badge-sun" : "badge-neutral"}`} aria-pressed={tags.includes(tag)} onClick={() => toggle(tag)}>{tag}</button>
        ))}
      </div>
      <textarea
        className="min-h-16 w-full rounded-sm border-2 border-line bg-paper p-3 font-semibold text-sm outline-none focus:border-ink"
        placeholder="¿Algo que le sirva al siguiente alumno? (opcional)"
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
      />
      <p className="font-semibold text-ink-subtle text-xs">Solo puedes reseñar sesiones realizadas; la reseña aparece en su perfil como «sesión verificada».</p>
      <div className="flex justify-end">
        <button className="btn btn-primary btn-sm" type="button" onClick={() => review(booking.id, { rating, tags, text })}>Publicar reseña</button>
      </div>
    </section>
  );
}
