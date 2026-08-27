import { createGuessHandler } from "@/http/handlers/guess";
import { invokeWithDeps } from "@/http/http-utils";
import { getProductionHttpDeps } from "@/http/production-deps";

// External URL: POST /guess/api/games/:gameId/round/guess
export async function POST(request: Request, context: { params: Promise<{ gameId: string }> }): Promise<Response> {
  const params = await context.params;
  return invokeWithDeps(getProductionHttpDeps, createGuessHandler, request, params);
}
