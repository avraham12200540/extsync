import type { RouteHandler } from "../deps";
import { jsonResponse } from "../http-utils";

/**
 * GET /guess/api/health - pure liveness, deliberately not readiness: no
 * database ping, no secret/env value, no internal topology (container
 * names, connection strings, versions). Just "this process can serve a
 * request right now." A DB-aware readiness check is a later, deployment-
 * stage concern (see README).
 */
export function createHealthHandler(): RouteHandler {
  return async () => {
    return jsonResponse(200, { status: "ok" });
  };
}
