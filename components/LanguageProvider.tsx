"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_LANG,
  DICT,
  LOCALE,
  matchLang,
  translateGroup,
  translateRound,
  translateTeam,
  type Lang,
} from "@/lib/i18n";

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  locale: string;
  t: (key: keyof (typeof DICT)["en"]) => string;
  team: (name: string) => string;
  round: (name: string) => string;
  group: (name: string | null | undefined) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = "wc-lang";

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  useEffect(() => {
    // A saved manual choice always wins; otherwise auto-detect from the
    // browser's ordered language preferences (falling back to English).
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "zh") {
      setLangState(saved);
      return;
    }
    const tags = navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
    setLangState(matchLang(tags));
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      setLang,
      locale: LOCALE[lang],
      t: (key) => DICT[lang][key],
      team: (name) => translateTeam(name, lang),
      round: (name) => translateRound(name, lang),
      group: (name) => translateGroup(name, lang),
    }),
    [lang, setLang],
  );

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return ctx;
}
