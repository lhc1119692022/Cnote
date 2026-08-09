import en from "./locales/en";
import zh from "./locales/zh";

export type Locale = "en" | "zh";

const translations = {
  en,
  zh,
};

export function getTranslation(locale: Locale) {
  return translations[locale] || translations.en;
}

export function t(locale: Locale, key: string): string {
  const translation = getTranslation(locale);
  const keys = key.split(".");
  let value: any = translation;

  for (const k of keys) {
    value = value?.[k];
    if (value === undefined) break;
  }

  return value || key;
}
