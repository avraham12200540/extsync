/**
 * GET /ctf/transfer - a stored record, and what actually leaves the page with it.
 *
 * The step turns on a mismatch: the record shows one identifier, and the value
 * that ends up on the clipboard is somewhere else entirely. Two carriers, both
 * pointing at the same place:
 *
 *  1. A `copy` listener scoped to the record. It fires only when the selection
 *     touches the record, so copying anything else on the page behaves
 *     completely normally.
 *  2. Markup that is visually hidden but still part of the selection, as a
 *     silent fallback for whenever the listener does not run.
 *
 * Nothing on the page names the mechanism, and there is no button. Players
 * arrive here from a thread about a site that writes to the clipboard, and that
 * context is meant to be the whole prompt.
 */

import { headers } from "next/headers";

import { escapeHtml } from "../_lib/document";
import { htmlResponse } from "../_lib/response";
import { CTF_BASE_CSS } from "../_lib/theme";
import { DISPLAY_ID, PATH_PARTS, RECORD_CSS } from "./_record";

/**
 * The interception, as a string because the document is assembled by hand.
 *
 * `intersectsNode` is what keeps this polite: a selection that never touches
 * the record is left alone and copies exactly what the user selected. The
 * pieces are joined at event time rather than stored assembled.
 */
function buildScript(parts: readonly string[]): string {
  const literals = parts.map((part) => JSON.stringify(part)).join(",");
  return `(function(){
var r=document.getElementById("rec");
if(!r||!document.getSelection)return;
var p=[${literals}];
document.addEventListener("copy",function(e){
var s=document.getSelection();
if(!s||s.isCollapsed||!e.clipboardData)return;
var hit=false;
for(var i=0;i<s.rangeCount;i++){if(s.getRangeAt(i).intersectsNode(r)){hit=true;break;}}
if(!hit)return;
var v=p.join("");
e.clipboardData.setData("text/plain",v);
e.clipboardData.setData("text/html",v);
e.preventDefault();
});
})();`;
}

/** The same pieces again, carried by the markup instead of by the script. */
function buildFallback(parts: readonly string[]): string {
  const spans = parts
    .map((part, index) => `<span>${escapeHtml(index === 0 ? `\n${part}` : part)}</span>`)
    .join("");
  return `<span class="rec__x" aria-hidden="true">${spans}</span>`;
}

function buildBody(nonce: string | undefined): string {
  const script = buildScript(PATH_PARTS);
  return `<main class="ctf-view">
  <section class="rec" id="rec">
    <div class="rec__head">TRANSFER RECORD</div>
    <dl class="rec__grid">
      <dt class="rec__k">ID</dt>
      <dd class="rec__v rec__v--id">${escapeHtml(DISPLAY_ID)}${buildFallback(PATH_PARTS)}</dd>
      <dt class="rec__k">STATUS</dt>
      <dd class="rec__v">stored</dd>
      <dt class="rec__k">SOURCE</dt>
      <dd class="rec__v">external</dd>
    </dl>
  </section>
</main>
<script${nonce ? ` nonce="${escapeHtml(nonce)}"` : ""}>${script}</script>`;
}

export async function GET(): Promise<Response> {
  // The site serves a fresh nonce per request from src/proxy.ts and its CSP has
  // no 'unsafe-inline' for scripts, so the tag has to carry that same nonce.
  // Without one the script is simply dropped and the markup fallback carries
  // the step, which is exactly what the fallback is for.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return htmlResponse({
    title: "Transfer record",
    lang: "en",
    dir: "ltr",
    css: `${CTF_BASE_CSS}\n\n${RECORD_CSS}`,
    body: buildBody(nonce),
  });
}
