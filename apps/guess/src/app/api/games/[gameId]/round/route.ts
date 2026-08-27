import { createRoundHandler } from "@/http/handlers/round";
import { invokeWithDeps } from "@/http/http-utils";
import { getProductionHttpDeps } from "@/http/production-deps";

// External URL: GET /guess/api/games/:gameId/round
export async function GET(request: Request, context: { params: Promise<{ gameId: string }> }): Promise<Response> {
  const params = await context.params;
  return invokeWithDeps(getProductionHttpDeps, createRoundHandler, request, params);
}
