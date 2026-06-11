import { cookies } from "next/headers";
import { LOCALE_COOKIE, type Locale } from "./i18n";

/** Server-side locale (cookie-based). Note: reading cookies opts the route into
 *  dynamic rendering - accepted tradeoff for correct bilingual SSR. */
export function getLocale(): Locale {
  return cookies().get(LOCALE_COOKIE)?.value === "en" ? "en" : "he";
}
