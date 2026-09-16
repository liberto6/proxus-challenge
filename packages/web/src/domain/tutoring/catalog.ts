import type { FolderSubject } from "@proxus/shared";

/**
 * Catalogue a folder's subject is chosen from: university → degree → subject.
 * A fixture for the prototype; the product would serve it from the university
 * catalogue Proxus already keeps.
 */

export interface CatalogSubject {
  readonly name: string;
  readonly year: number;
}

export interface CatalogDegree {
  readonly name: string;
  readonly subjects: ReadonlyArray<CatalogSubject>;
}

export interface CatalogUniversity {
  readonly name: string;
  readonly degrees: ReadonlyArray<CatalogDegree>;
}

const biology: CatalogDegree = {
  name: "Biología",
  subjects: [
    { name: "Biología celular", year: 1 },
    { name: "Química general", year: 1 },
    { name: "Fisiología I", year: 2 },
    { name: "Genética", year: 2 },
    { name: "Ecología", year: 3 }
  ]
};

const computerScience: CatalogDegree = {
  name: "Ingeniería Informática",
  subjects: [
    { name: "Fundamentos de programación", year: 1 },
    { name: "Estructura de computadores", year: 1 },
    { name: "Arquitectura de sistemas", year: 2 },
    { name: "Bases de datos", year: 2 },
    { name: "Sistemas operativos", year: 3 }
  ]
};

const business: CatalogDegree = {
  name: "ADE",
  subjects: [
    { name: "Contabilidad financiera", year: 1 },
    { name: "Microeconomía", year: 1 },
    { name: "Estadística", year: 2 },
    { name: "Marketing", year: 2 }
  ]
};

const medicine: CatalogDegree = {
  name: "Medicina",
  subjects: [
    { name: "Anatomía I", year: 1 },
    { name: "Bioquímica", year: 1 },
    { name: "Fisiología", year: 2 },
    { name: "Farmacología", year: 3 }
  ]
};

export const catalog: ReadonlyArray<CatalogUniversity> = [
  { name: "UCM", degrees: [biology, computerScience, business, medicine] },
  { name: "UAM", degrees: [biology, medicine, business] },
  { name: "UPM", degrees: [computerScience] },
  { name: "UB", degrees: [biology, business, medicine] }
];

export const degreesOf = (university: string): ReadonlyArray<CatalogDegree> =>
  catalog.find((item) => item.name === university)?.degrees ?? [];

export const subjectsOf = (university: string, degree: string): ReadonlyArray<CatalogSubject> =>
  degreesOf(university).find((item) => item.name === degree)?.subjects ?? [];

/** "UCM · Biología · 2.º" */
export const describeSubject = (subject: FolderSubject): string =>
  [subject.university, subject.degree, subject.year === undefined ? undefined : `${subject.year}.º`].filter((part) => part !== undefined).join(" · ");
