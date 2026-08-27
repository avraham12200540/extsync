import { createResultsHandler } from "@/http/handlers/results";
import { invokeWithDeps } from "@/http/http-utils";
import { getProductionHttpDeps } from "@/http/production-deps";

// External URL: GET /guess/api/games/:gameId/results
export async function GET(request: Request, context: { params: Promise<{ gameId: string }> }): Promise<Response> {
  const params = await context.params;
  return invokeWithDeps(getProductionHttpDeps, createResultsHandler, request, params);
}
