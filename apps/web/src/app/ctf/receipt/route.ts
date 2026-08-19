/**
 * GET /ctf/receipt - answers only a conditional request.
 *
 * The status codes carry the whole conversation, which is the point of the
 * step: 428 says a precondition is required, 412 says the precondition was
 * there and did not hold. Neither body explains more than the status already
 * does, and neither ever names the value it is waiting for.
 */

import { textResponse } from "../_lib/response";
import { ARCHIVE_ID, ifMatchSatisfied } from "./_receipt";

const RECEIPT = `receipt   ok\narchive   ${ARCHIVE_ID}\n`;

export function GET(request: Request): Response {
  const ifMatch = request.headers.get("if-match");

  if (ifMatch === null) {
    return textResponse("precondition required\n", { status: 428 });
  }
  if (!ifMatchSatisfied(ifMatch)) {
    return textResponse("precondition failed\n", { status: 412 });
  }
  return textResponse(RECEIPT);
}
