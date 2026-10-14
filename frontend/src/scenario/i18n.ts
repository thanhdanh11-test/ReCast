import { createContext, useContext } from "react";
import { EN } from "./i18n.en";
import type { Language } from "./preferences";

/**
 * UI language. Strings are keyed by their Vietnamese source text: `t("Cài đặt")`. Vietnamese is the
 * default; English falls back to the key when a phrase has no entry (i18n.test.ts forbids that for
 * literal keys). `{name}` placeholders are filled from `vars`. Backend error messages stay Vietnamese.
 */
export type Translate = (vi: string, vars?: Record<string, string | number>) => string;

export function translate(language: Language, vi: string, vars?: Record<string, string | number>): string {
    const text = language === "en" ? EN[vi] ?? vi : vi;
    return vars ? text.replace(/\{(\w+)\}/g, (all: string, key: string) => (key in vars ? String(vars[key]) : all)) : text;
}

const LanguageContext = createContext<Language>("vi");
export const LanguageProvider = LanguageContext.Provider;
export function useLanguage(): Language { return useContext(LanguageContext); }
export function useT(): Translate {
    const language = useContext(LanguageContext);
    return (vi, vars) => translate(language, vi, vars);
}
