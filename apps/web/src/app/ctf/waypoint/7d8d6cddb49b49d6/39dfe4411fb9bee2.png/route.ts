/**
 * GET /ctf/waypoint/<id>/<png> - the waypoint's alternate representation.
 *
 * A literal folder for the same reason as every other named destination in
 * this trail: the filename is not compared here, it *is* the route, so any
 * other name under this waypoint matches no route and gets the site's
 * ordinary 404.
 *
 * Fixed bytes and nothing else: no query, no path parameter, no filesystem
 * read. What is served is a real, standards-valid PNG (see ../_artifact.ts)
 * - the point of this step is that the image decodes cleanly and still says
 * more than its pixels do.
 */

import { imageResponse } from "../../../_lib/response";
import { ARTIFACT_NAME, PNG_BYTES } from "../_artifact";

export function GET(): Response {
  return imageResponse(PNG_BYTES, "image/png", ARTIFACT_NAME);
}
