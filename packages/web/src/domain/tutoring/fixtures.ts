import type { FolderSubject } from "@proxus/shared";

/**
 * Sample tutors for the prototype. There is no server side: the tutors of a
 * subject are generated from a small cast so that any subject of the
 * catalogue has three, with topics that match what the subject is about.
 */

export interface TutorReview {
  readonly id: string;
  readonly author: string;
  readonly when: string;
  readonly text: string;
  readonly tags: ReadonlyArray<string>;
  readonly rating: number;
  /** Written by the student in this browser (a booked session), not a sample. */
  readonly own?: boolean;
}

export interface TutorSlot {
  readonly id: string;
  readonly label: string;
  readonly taken?: boolean;
}

export interface Tutor {
  readonly id: string;
  readonly initial: string;
  readonly name: string;
  readonly tone: "sun" | "lila" | "mint";
  /** "4.º Biología · UCM" */
  readonly meta: string;
  readonly grade: string;
  readonly rating: number;
  readonly reviewCount: number;
  readonly sessions: number;
  readonly replyTime: string;
  readonly bio: string;
  readonly topics: ReadonlyArray<string>;
  readonly slots: ReadonlyArray<TutorSlot>;
  readonly price30: number;
  readonly price60: number;
  readonly reviews: ReadonlyArray<TutorReview>;
}

/** The topics a subject is about, for the tutors' "strong in" chips. */
const topicsBySubject: Record<string, ReadonlyArray<string>> = {
  "Fisiología I": ["Transporte de membrana", "Potencial de acción", "Sinapsis", "Homeostasis"],
  "Biología celular": ["Ciclo celular", "Mitocondria", "Membrana plasmática", "Síntesis de proteínas"],
  "Genética": ["Leyes de Mendel", "Ligamiento", "Mutaciones", "Genética de poblaciones"],
  "Ecología": ["Ciclo del agua", "Ciclos biogeoquímicos", "Dinámica de poblaciones", "Sucesión ecológica"],
  "Química general": ["Estequiometría", "Equilibrio químico", "Enlace químico", "Termoquímica"],
  "Fundamentos de programación": ["Recursividad", "Punteros", "Complejidad", "Estructuras de datos"],
  "Estructura de computadores": ["Jerarquía de memoria", "Ensamblador", "Segmentación", "Caché"],
  "Arquitectura de sistemas": ["Rendimiento de un procesador", "Tiempo de CPU", "Ley de Amdahl", "Jerarquía de memoria"],
  "Bases de datos": ["Modelo relacional", "Normalización", "SQL", "Transacciones"],
  "Sistemas operativos": ["Planificación", "Memoria virtual", "Concurrencia", "Sistemas de ficheros"],
  "Contabilidad financiera": ["Balance", "Cuenta de resultados", "Amortizaciones", "Asientos"],
  "Microeconomía": ["Elasticidad", "Curvas de indiferencia", "Competencia perfecta", "Monopolio"],
  "Estadística": ["Distribuciones", "Contraste de hipótesis", "Regresión", "Intervalos de confianza"],
  "Marketing": ["Segmentación", "Marketing mix", "Posicionamiento", "Investigación de mercados"],
  "Anatomía I": ["Osteología", "Miología", "Articulaciones", "Sistema nervioso"],
  "Bioquímica": ["Enzimas", "Glucólisis", "Ciclo de Krebs", "Lípidos"],
  "Fisiología": ["Sistema cardiovascular", "Respiración", "Riñón", "Endocrino"],
  "Farmacología": ["Farmacocinética", "Receptores", "Antibióticos", "Analgésicos"]
};

const genericTopics = ["Tema 1", "Tema 2", "Problemas de examen", "Repaso final"];

const cast = [
  {
    key: "marta",
    initial: "M",
    name: "Marta R.",
    tone: "sun" as const,
    yearOffset: 2,
    grade: "8,7",
    rating: 4.9,
    reviewCount: 23,
    sessions: 31,
    replyTime: "responde en menos de 2 h",
    bio: "Aprobé la asignatura el curso pasado con nota. Explico con dibujos y ejemplos de examen; si me pasas tu quiz fallado, vamos directos a lo que se te atraganta.",
    slots: [["Mañana 18:00"], ["Mañana 18:30"], ["Jue 17:30"], ["Jue 18:00", true], ["Sáb 11:00"], ["Sáb 11:30"]],
    price30: 40,
    price60: 70,
    topicIndexes: [0, 1, 2],
    reviews: [
      ["Pablo G.", "hace 3 días", "Me lo explicó con un dibujo y por fin lo vi. Fuimos directos a las preguntas que había fallado.", ["Explica claro", "Puntual"]],
      ["Aina T.", "hace 2 semanas", "Media hora bien aprovechada. Me dejó un esquema para repasar antes del parcial.", ["Va al grano", "Deja material"]],
      ["Hugo M.", "hace 1 mes", "Muy paciente con las dudas tontas. Repetiría.", ["Paciente"]]
    ]
  },
  {
    key: "diego",
    initial: "D",
    name: "Diego L.",
    tone: "lila" as const,
    yearOffset: 1,
    grade: "7,9",
    rating: 4.7,
    reviewCount: 11,
    sessions: 14,
    replyTime: "responde en menos de 1 día",
    bio: "Lo suspendí en primera y lo saqué en segunda, así que sé exactamente dónde se falla. Voy con ejercicios resueltos paso a paso.",
    slots: [["Hoy 20:00"], ["Mié 19:00"], ["Vie 18:00"]],
    price30: 35,
    price60: 60,
    topicIndexes: [1, 3],
    reviews: [
      ["Carla V.", "hace 1 semana", "Se nota que sabe dónde están las trampas del examen.", ["Va al grano"]],
      ["Iván S.", "hace 3 semanas", "Bien, aunque a veces va rápido; le pedí repetir y sin problema.", ["Paciente"]]
    ]
  },
  {
    key: "lucia",
    initial: "L",
    name: "Lucía P.",
    tone: "mint" as const,
    yearOffset: 4,
    grade: "9,4",
    rating: 4.8,
    reviewCount: 40,
    sessions: 58,
    replyTime: "responde en menos de 3 h",
    bio: "Estoy en el máster y doy clases desde hace dos años. Prefiero sesiones de una hora para dejar el tema cerrado.",
    slots: [["Vie 16:00"], ["Sáb 10:00"]],
    price30: 55,
    price60: 95,
    topicIndexes: [2, 3, 0],
    reviews: [
      ["Nerea O.", "hace 5 días", "Una hora y salí con el tema entero claro. Cara, pero merece la pena antes del examen.", ["Explica claro", "Deja material"]],
      ["Mario A.", "hace 2 meses", "Muy estructurada. Te manda un resumen después.", ["Deja material", "Puntual"]]
    ]
  }
] as const;

const ordinal = (year: number) => `${year}.º`;

/** The three sample tutors of a subject, with topics and course adapted to it. */
export const tutorsFor = (subject: FolderSubject): ReadonlyArray<Tutor> => {
  const topics = topicsBySubject[subject.name] ?? genericTopics;
  const year = subject.year ?? 1;
  return cast.map((member) => ({
    id: `${member.key}-${slug(subject.name)}`,
    initial: member.initial,
    name: member.name,
    tone: member.tone,
    meta: member.key === "lucia"
      ? `Máster · ${subject.university}`
      : `${ordinal(Math.min(year + member.yearOffset, 4))} ${subject.degree} · ${subject.university}`,
    grade: `Aprobó ${subject.name} con ${member.grade}`,
    rating: member.rating,
    reviewCount: member.reviewCount,
    sessions: member.sessions,
    replyTime: member.replyTime,
    bio: member.bio,
    topics: member.topicIndexes.map((index) => topics[index % topics.length]!),
    slots: member.slots.map(([label, taken], index) => ({ id: `${member.key}-${index}`, label, ...(taken === true ? { taken: true } : {}) })),
    price30: member.price30,
    price60: member.price60,
    reviews: member.reviews.map(([author, when, text, tags], index) => ({
      id: `${member.key}-r${index}`,
      author: `${author} · ${ordinal(year)} ${subject.degree}`,
      when,
      text,
      tags,
      rating: 5
    }))
  }));
};

export const reviewTags = ["Explica claro", "Va al grano", "Puntual", "Paciente", "Deja material"] as const;

export const slug = (value: string): string => value
  .toLocaleLowerCase()
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");
