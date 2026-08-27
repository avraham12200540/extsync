import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizePost } from "../../src/importer/sanitize";

// Every fixture below is hand-written synthetic HTML - never a real forum
// post body - constructed to exercise one sanitizer rule at a time.

test("strips <script> entirely, including its text content", () => {
  const { cleanText } = sanitizePost({
    rawHtml: '<p>hello</p><script>alert(document.cookie)</script><p>world</p>',
    authorUsername: "author1",
    authorUserslug: "author1",
  });
  assert.doesNotMatch(cleanText, /alert|cookie|script/i);
  assert.match(cleanText, /hello/);
  assert.match(cleanText, /world/);
});

test("strips <style> entirely, including its text content", () => {
  const { cleanText } = sanitizePost({
    rawHtml: "<style>body{color:red}</style><p>visible text</p>",
    authorUsername: "author1",
    authorUserslug: "author1",
  });
  assert.doesNotMatch(cleanText, /color|red/i);
  assert.match(cleanText, /visible text/);
});

test("event-handler attributes never survive, since only text nodes are ever serialized", () => {
  const { cleanText } = sanitizePost({
    rawHtml: '<div onclick="stealCookies()">safe text</div>',
    authorUsername: "author1",
    authorUserslug: "author1",
  });
  assert.doesNotMatch(cleanText, /stealCookies/);
  assert.match(cleanText, /safe text/);
});

test("malicious img with onerror is removed entirely (image stripping, not just attribute stripping)", () => {
  const { cleanText } = sanitizePost({
    rawHtml: '<p>before</p><img src=x onerror="evil()"><p>after</p>',
    authorUsername: "author1",
    authorUserslug: "author1",
  });
  assert.doesNotMatch(cleanText, /evil/);
  assert.match(cleanText, /before/);
  assert.match(cleanText, /after/);
});

test("decodes ordinary HTML entities", () => {
  const { cleanText } = sanitizePost({
    rawHtml: "<p>Tom &amp; Jerry &lt;3 &quot;quotes&quot; it&#39;s fine</p>",
    authorUsername: "author1",
    authorUserslug: "author1",
  });
  assert.match(cleanText, /Tom & Jerry <3 "quotes" it's fine/);
});

test("preserves emoji characters (plain Unicode, not markup)", () => {
  const { cleanText } = sanitizePost({
    rawHtml: "<p>מגניב 😀🎉 nice</p>",
    authorUsername: "author1",
    authorUserslug: "author1",
  });
  assert.match(cleanText, /😀/);
  assert.match(cleanText, /🎉/);
});

test("removes blockquote quote-attribution blocks and computes quoteRatio", () => {
  const { cleanText, stats } = sanitizePost({
    rawHtml: "<blockquote>someone else said something long here</blockquote><p>my own reply</p>",
    authorUsername: "author1",
    authorUserslug: "author1",
  });
  assert.doesNotMatch(cleanText, /someone else said/);
  assert.match(cleanText, /my own reply/);
  assert.ok(stats.quoteRatio > 0.5, `expected quoteRatio > 0.5, got ${stats.quoteRatio}`);
});

test("post with no quotes has quoteRatio 0", () => {
  const { stats } = sanitizePost({
    rawHtml: "<p>entirely original content</p>",
    authorUsername: "author1",
    authorUserslug: "author1",
  });
  assert.equal(stats.quoteRatio, 0);
});

test("strips a NodeBB-style mention link entirely (text and href both)", () => {
  const { cleanText, stats } = sanitizePost({
    rawHtml: '<p>hey <a class="plugin-mentions-a" href="/user/someone-else">@someone-else</a> check this</p>',
    authorUsername: "author1",
    authorUserslug: "author1",
  });
  assert.doesNotMatch(cleanText, /someone-else/);
  assert.equal(stats.mentionsCount, 1);
  assert.match(cleanText, /hey/);
  assert.match(cleanText, /check this/);
});

test("strips a profile/source URL link (by /user/ href) even without a mention class", () => {
  const { cleanText, stats } = sanitizePost({
    rawHtml: '<p>see <a href="/user/someone-else">their profile</a></p>',
    authorUsername: "author1",
    authorUserslug: "author1",
  });
  assert.doesNotMatch(cleanText, /their profile/);
  assert.equal(stats.mentionsCount, 1);
});

test("unwraps an ordinary content link to its visible text, discarding the href", () => {
  const { cleanText, stats } = sanitizePost({
    rawHtml: '<p>see <a href="https://example.com/some/path?x=1">this article</a> please</p>',
    authorUsername: "author1",
    authorUserslug: "author1",
  });
  assert.match(cleanText, /this article/);
  assert.doesNotMatch(cleanText, /example\.com/);
  assert.equal(stats.linksCount, 1);
});

test("strips a bare pasted URL that appears as plain text, not just inside an <a>", () => {
  const { cleanText } = sanitizePost({
    rawHtml: "<p>check https://mitmachim.top/topic/12345 out</p>",
    authorUsername: "author1",
    authorUserslug: "author1",
  });
  assert.doesNotMatch(cleanText, /mitmachim\.top/);
  assert.match(cleanText, /check/);
  assert.match(cleanText, /out/);
});

test("redacts the author's own username self-reference and flags it", () => {
  const { cleanText, stats } = sanitizePost({
    rawHtml: "<p>בתור dovi123 אני חושב שזה נכון</p>",
    authorUsername: "dovi123",
    authorUserslug: "dovi123",
  });
  assert.doesNotMatch(cleanText, /dovi123/);
  assert.equal(stats.selfReferenceDetected, true);
});

test("does not flag a post with no self-reference", () => {
  const { stats } = sanitizePost({
    rawHtml: "<p>a perfectly ordinary post</p>",
    authorUsername: "dovi123",
    authorUserslug: "dovi123",
  });
  assert.equal(stats.selfReferenceDetected, false);
});

test("catches a self-reference even when bidi-control marks are interspersed inside the username (evasion attempt)", () => {
  // ‮ is RLO (right-to-left override) - inserted mid-username the way
  // an adversarial post might try to visually/structurally hide it.
  const evasive = "d‮ovi‬123";
  const { cleanText, stats } = sanitizePost({
    rawHtml: `<p>signed, ${evasive}</p>`,
    authorUsername: "dovi123",
    authorUserslug: "dovi123",
  });
  assert.equal(stats.selfReferenceDetected, true);
  assert.doesNotMatch(cleanText, /dovi123/);
});

test("strips bidi control and zero-width characters from ordinary text", () => {
  const withBidi = "hello​world‮test‬‎end";
  const { cleanText } = sanitizePost({
    rawHtml: `<p>${withBidi}</p>`,
    authorUsername: "author1",
    authorUserslug: "author1",
  });
  assert.equal(/[​‎‮‬]/u.test(cleanText), false);
  assert.match(cleanText, /helloworldtestend/);
});

test("handles a Hebrew/Latin mixed username with bidi marks as an ordinary (non-self-referencing) mention target without crashing", () => {
  const mixedUsername = "‫דוד123‬";
  const { cleanText, stats } = sanitizePost({
    rawHtml: "<p>שלום לכולם, מה שלומכם היום?</p>",
    authorUsername: mixedUsername,
    authorUserslug: "some-other-slug",
  });
  assert.equal(stats.selfReferenceDetected, false);
  assert.match(cleanText, /שלום לכולם/);
});

test("removes a signature block identified by a conventional class name", () => {
  const { cleanText, stats } = sanitizePost({
    rawHtml: '<p>the actual post</p><div class="signature">sent from my phone - visit my site</div>',
    authorUsername: "author1",
    authorUserslug: "author1",
  });
  assert.match(cleanText, /the actual post/);
  assert.doesNotMatch(cleanText, /sent from my phone/);
  assert.equal(stats.hadSignatureBlock, true);
});

test("preserves paragraph structure and ordinary Hebrew/English punctuation across a long, ordinary post", () => {
  const raw =
    "<p>שלום, זו הודעה ארוכה וסבירה עם כמה משפטים. יש בה פיסוק תקין: פסיקים, נקודות, וסימני שאלה?</p>" +
    "<p>Second paragraph in English, with normal punctuation: commas, periods, and \"quotes\" too!</p>";
  const { cleanText } = sanitizePost({ rawHtml: raw, authorUsername: "author1", authorUserslug: "author1" });
  assert.match(cleanText, /שלום, זו הודעה ארוכה/);
  assert.match(cleanText, /Second paragraph in English/);
  // Two source paragraphs must remain visually separated.
  assert.ok(cleanText.includes("\n"), "expected a paragraph break to survive flattening");
});

test("never invents text: output is a subset (character-wise) of what was structurally present, never new prose", () => {
  const { cleanText } = sanitizePost({
    rawHtml: "<p>original wording only</p>",
    authorUsername: "author1",
    authorUserslug: "author1",
  });
  assert.equal(cleanText, "original wording only");
});
