import * as cheerio from "cheerio";

/**
 * Deterministic HTML -> safe plain text for imported forum posts.
 *
 * Markup is parsed with cheerio (a maintained HTML parser/DOM, built on
 * htmlparser2+domhandler) rather than regular expressions - regex cannot
 * reliably walk nested/malformed HTML, which is exactly the kind of input
 * untrusted forum content is. The only regex-based passes in this file
 * operate on already-flattened PLAIN TEXT (bidi/control-character
 * stripping, a bare-URL cleanup pass) - not on markup.
 *
 * This module never renders HTML and never calls dangerouslySetInnerHTML
 * anywhere; the output is always a plain string meant for a plain text
 * node in the UI.
 *
 * This module NEVER invents or paraphrases text - every transformation
 * here is subtractive (remove/redact) or purely structural (paragraph
 * breaks), never generative.
 */

const MENTION_HREF_PATTERN = /^\/user\//i;
const MENTION_CLASS_PATTERN = /mention/i;
const SIGNATURE_CLASS_PATTERN = /signature/i;
const BARE_URL_PATTERN = /https?:\/\/\S+/gi;

// Bidi control characters - LRM/RLM (U+200E, U+200F), LRE/RLE/PDF/LRO/RLO
// (U+202A-202E), LRI/RLI/FSI/PDI (U+2066-2069), ALM (U+061C) - plus
// zero-width characters ZWSP/ZWNJ/ZWJ (U+200B-200D) and a BOM (U+FEFF).
// None of these are needed for legitimate mixed Hebrew/English text - the
// Unicode Bidi Algorithm already handles normal RTL/LTR mixing without
// embedding control characters, so their presence in forum content is
// either an artifact worth dropping or (as in "Trojan Source"-style
// attacks) actively misleading about the text's true reading order.
// Written with explicit \u escapes (not literal invisible characters) so
// the exact codepoints covered are verifiable by reading this file.
const BIDI_AND_ZERO_WIDTH_PATTERN = /[\u061C\u200B-\u200F\u2066-\u2069\u202A-\u202E\uFEFF]/gu;
// C0/C1 control characters except \n (U+000A) and \t (U+0009).
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

export interface SanitizeInput {
  rawHtml: string;
  authorUsername: string;
  authorUserslug: string;
}

export interface SanitizeStats {
  linksCount: number;
  mentionsCount: number;
  quoteRatio: number;
  hadSignatureBlock: boolean;
  selfReferenceDetected: boolean;
}

export interface SanitizeResult {
  cleanText: string;
  stats: SanitizeStats;
}

function stripBidiAndControlChars(text: string): string {
  return text.replace(BIDI_AND_ZERO_WIDTH_PATTERN, "").replace(CONTROL_CHAR_PATTERN, "");
}

function stripBareUrls(text: string): string {
  return text.replace(BARE_URL_PATTERN, "");
}

function collapseWhitespace(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Case-insensitive literal-substring redaction; not a regex word-boundary match, since Hebrew has no simple `\b` equivalent. */
function redactSelfReferences(text: string, needles: string[]): { text: string; matched: boolean } {
  let result = text;
  let matched = false;
  for (const needle of needles) {
    if (needle.length === 0) continue;
    const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    if (pattern.test(result)) {
      matched = true;
      result = result.replace(pattern, "***");
    }
  }
  return { text: result, matched };
}

export function sanitizePost(input: SanitizeInput): SanitizeResult {
  // cheerio.load() always produces a full document (wrapping a bare
  // fragment in <html><body>...</body></html> if needed), so `body`
  // always exists - this avoids a Cheerio<Element> | Cheerio<Document>
  // union that would otherwise infect every .find()/.each() call below.
  const $ = cheerio.load(input.rawHtml);
  const root = $("body");

  // Never execute or render: drop entirely regardless of content.
  root.find("script, style").remove();

  // Structural / embedded media the game must never display.
  root.find("iframe, embed, object, video, audio, img").remove();

  // Signature blocks, where identifiable by a conventional class name.
  // Best-effort: NodeBB does not guarantee a single canonical signature
  // wrapper, so this only catches the common `class*="signature"` case,
  // not every possible signature rendering (documented limitation).
  const signatureNodes = root.find("[class]").filter((_, el) => SIGNATURE_CLASS_PATTERN.test($(el).attr("class") ?? ""));
  const hadSignatureBlock = signatureNodes.length > 0;
  signatureNodes.remove();

  // Quote-attribution blocks: measure their share of the content, then
  // drop them entirely (including the attribution) - quoted text is not
  // this author's own writing.
  const totalTextForRatio = root.text();
  const quoteText = root.find("blockquote").text();
  const quoteRatio = totalTextForRatio.length > 0 ? Math.min(1, quoteText.length / totalTextForRatio.length) : 0;
  root.find("blockquote").remove();

  // Links: count all of them, then either drop entirely (mentions /
  // profile links - the destination itself names a specific person) or
  // unwrap to their visible text while discarding the href (ordinary
  // content links) so the destination URL never survives into clean text.
  let linksCount = 0;
  let mentionsCount = 0;
  root.find("a").each((_, el) => {
    const node = $(el);
    const href = node.attr("href") ?? "";
    if (href) linksCount += 1;
    const isMention = MENTION_CLASS_PATTERN.test(node.attr("class") ?? "") || MENTION_HREF_PATTERN.test(href);
    if (isMention) {
      mentionsCount += 1;
      node.remove();
    } else {
      node.replaceWith(node.text());
    }
  });

  // Paragraph/line-break structure must survive flattening to plain
  // text: cheerio's .text() concatenates text nodes with no separator,
  // so block boundaries are made explicit before flattening.
  root.find("br").each((_, el) => {
    $(el).replaceWith("\n");
  });
  root.find("p, div, li").each((_, el) => {
    $(el).append("\n");
  });

  let text = root.text();
  text = stripBareUrls(text);
  // Bidi/control-char stripping happens BEFORE self-reference detection
  // (not after): a username hidden by interspersing bidi-control marks
  // inside it (e.g. "u<RLO>se<PDF>r") would otherwise dodge a plain
  // substring match. Stripping those marks first collapses it back to a
  // contiguous "user" that the check below can actually catch. The same
  // stripping is applied to the needles themselves, in case the stored
  // username string ever contained such characters.
  text = stripBidiAndControlChars(text);

  const authorNeedles = [input.authorUsername, input.authorUserslug].map(stripBidiAndControlChars);
  const { text: redacted, matched: selfReferenceDetected } = redactSelfReferences(text, authorNeedles);
  text = redacted;

  text = collapseWhitespace(text);

  return {
    cleanText: text,
    stats: {
      linksCount,
      mentionsCount,
      quoteRatio,
      hadSignatureBlock,
      selfReferenceDetected,
    },
  };
}
