import { createGamesFreeplayHandler } from "@/http/handlers/games-freeplay";
import { invokeWithDeps } from "@/http/http-utils";
import { getProductionHttpDeps } from "@/http/production-deps";

// External URL: POST /guess/api/games/freeplay
export async function POST(request: Request): Promise<Response> {
  return invokeWithDeps(getProductionHttpDeps, createGamesFreeplayHandler, request, {});
}
