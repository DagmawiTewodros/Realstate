import type { Locale } from "@platform/shared";

export interface LocalizedMessage {
  subject: string;
  text: string;
}

/** Message templates: key -> language -> subject and text with {{placeholders}}. */
export type TemplateSet = Record<string, Record<Locale, LocalizedMessage>>;

export class TemplateError extends Error {}

/** Fills {{placeholders}}. A placeholder without a value is an error, so a broken template is caught in tests. */
export function renderTemplate(templates: TemplateSet, key: string, locale: Locale, data: Record<string, unknown>): LocalizedMessage {
  const template = templates[key]?.[locale] ?? templates[key]?.en;
  if (!template) throw new TemplateError(`No template "${key}"`);
  const fill = (text: string) =>
    text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, name: string) => {
      const value = data[name];
      if (value === undefined || value === null) throw new TemplateError(`Template "${key}" needs "${name}"`);
      return String(value);
    });
  return { subject: fill(template.subject), text: fill(template.text) };
}

/** Lists placeholders used by a template, to check templates in tests. */
export function templatePlaceholders(templates: TemplateSet, key: string): string[] {
  const names = new Set<string>();
  for (const locale of Object.keys(templates[key] ?? {}) as Locale[]) {
    const t = templates[key][locale];
    for (const m of `${t.subject} ${t.text}`.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) names.add(m[1]);
  }
  return [...names];
}

export const OPT_OUT_LINE: Record<Locale, string> = {
  am: "እነዚህን መልእክቶች ማቆም ከፈለጉ፦ {{url}}",
  en: "To stop these messages: {{url}}",
};
