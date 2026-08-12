export type Gender = "male" | "female";

export interface Passport {
  id: string;
  guest_id: string;
  last_name: string | null;    // Фамилия
  first_name: string | null;   // Имя
  middle_name: string | null;  // Отчество
  birth_date: string | null;   // Дата рождения (yyyy-mm-dd)
  issue_date: string | null;   // Дата выдачи   (yyyy-mm-dd)
  citizenship: string | null;  // ISO-2 code (e.g. 'TJ')
  gender: Gender | null;       // Пол
  filled_count: number;        // For the "n/7" progress badge
  updated_at: string;
}

export const PASSPORT_FIELDS = [
  "last_name",
  "first_name",
  "middle_name",
  "birth_date",
  "issue_date",
  "citizenship",
  "gender",
] as const;

export const passportProgress = (p?: Partial<Passport> | null) =>
  `${PASSPORT_FIELDS.filter((f) => {
    const v = p?.[f as keyof Passport];
    return v !== null && v !== undefined && v !== "";
  }).length}/7`;