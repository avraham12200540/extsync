import type { Page, Route } from "@playwright/test";

/**
 * Synthetic in-memory backend for /guess/api/** - every browser test in this
 * suite runs against a real Next.js dev server (real /guess base path, real
 * client code) but with network calls to the game API intercepted here.
 * Nothing in this file touches a real database; see the "Mocked vs real"
 * note in the test report for what this does and does not prove.
 */

export interface MockChoice {
  choiceId: string;
  username: string;
}

export interface MockRoundConfig {
  roundId: string;
  orderInGame: number;
  posts: string[];
  choices: MockChoice[];
  correctChoiceId: string;
  maxHints: number;
}

export interface MockGameConfig {
  gameId: string;
  mode: "daily" | "freeplay";
  totalRounds: number;
  rounds: MockRoundConfig[];
  shareToken: string;
}

interface RoundState {
  config: MockRoundConfig;
  hintsRevealedCount: number;
  wrongGuessCount: number;
  status: "active" | "resolved_correct" | "resolved_incorrect";
  scoreAwarded: number | null;
}

const SCORE_BASE = 100;
const SCORE_HINT_PENALTY = 15;
const SCORE_WRONG_PENALTY = 20;

function availableScore(hintsRevealed: number, wrongGuesses: number): number {
  return Math.max(0, SCORE_BASE - (hintsRevealed - 1) * SCORE_HINT_PENALTY - wrongGuesses * SCORE_WRONG_PENALTY);
}

function roundView(state: RoundState) {
  const resolved = state.status !== "active";
  return {
    roundId: state.config.roundId,
    orderInGame: state.config.orderInGame,
    status: state.status,
    hintsRevealedCount: state.hintsRevealedCount,
    maxHints: state.config.maxHints,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    revealedPosts: state.config.posts.slice(0, state.hintsRevealedCount).map((cleanText, i) => ({ displayOrder: i + 1, cleanText })),
    choices: state.config.choices,
    wrongGuessCount: state.wrongGuessCount,
    currentAvailableScore: resolved ? 0 : availableScore(state.hintsRevealedCount, state.wrongGuessCount),
    scoreAwarded: resolved ? state.scoreAwarded : null,
    correctChoiceId: resolved ? state.config.correctChoiceId : null,
    correctUsername: resolved ? state.config.choices.find((c) => c.choiceId === state.config.correctChoiceId)!.username : null,
  };
}

export interface MockController {
  /** Force the next matching request (by method+pathname suffix) to fail with this status. */
  failNext(pathSuffix: string, status: number, code: string, retryAfterSeconds?: number): void;
  /** Force every request to abort at the network level (simulates offline), until cleared. */
  setOffline(offline: boolean): void;
  requestLog: { method: string; pathname: string }[];
}

export async function installMockApi(page: Page, gameConfig: MockGameConfig): Promise<MockController> {
  let csrfIssued = "csrf-token-fixture";
  let totalScore = 0;
  // Starts at 1, as if the game were already created - tests that create a
  // game via /games/daily or /games/freeplay overwrite this on that call;
  // tests that navigate straight to an "existing" game rely on this default.
  let currentRoundIndex = 1;
  let gameStatus: "active" | "completed" = "active";
  const roundStates = new Map<string, RoundState>(
    gameConfig.rounds.map((r) => [r.roundId, { config: r, hintsRevealedCount: 1, wrongGuessCount: 0, status: "active", scoreAwarded: null }]),
  );

  const pendingFailures = new Map<string, { status: number; code: string; retryAfterSeconds?: number }[]>();
  let offline = false;
  const requestLog: MockController["requestLog"] = [];

  function gameView() {
    return {
      gameId: gameConfig.gameId,
      mode: gameConfig.mode,
      status: gameStatus,
      currentRoundIndex,
      totalRounds: gameConfig.totalRounds,
      totalScore,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      shareToken: gameStatus === "completed" ? gameConfig.shareToken : null,
    };
  }

  async function fulfillJson(route: Route, status: number, body: unknown, extraHeaders?: Record<string, string>) {
    await route.fulfill({
      status,
      contentType: "application/json",
      headers: extraHeaders,
      body: JSON.stringify(body),
    });
  }

  async function fulfillError(route: Route, status: number, code: string, retryAfterSeconds?: number) {
    await fulfillJson(
      route,
      status,
      { error: { code, message: code } },
      retryAfterSeconds !== undefined ? { "retry-after": String(retryAfterSeconds) } : undefined,
    );
  }

  await page.route("**/guess/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname.replace(/^\/guess\/api/, "");
    const method = request.method();
    requestLog.push({ method, pathname });

    if (offline) {
      await route.abort("connectionfailed");
      return;
    }

    for (const [suffix, queue] of pendingFailures) {
      if (pathname.endsWith(suffix) && queue.length > 0) {
        const failure = queue.shift()!;
        if (queue.length === 0) pendingFailures.delete(suffix);
        await fulfillError(route, failure.status, failure.code, failure.retryAfterSeconds);
        return;
      }
    }

    if (method === "POST" && pathname === "/session") {
      await fulfillJson(route, 200, { csrfToken: csrfIssued, sessionExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString() });
      return;
    }

    if (method === "POST" && (pathname === "/games/daily" || pathname === "/games/freeplay")) {
      totalScore = 0;
      currentRoundIndex = 1;
      gameStatus = "active";
      await fulfillJson(route, 200, gameView());
      return;
    }

    const roundMatch = pathname.match(/^\/games\/([^/]+)\/round(\/hint|\/guess)?$/);
    if (roundMatch) {
      const action = roundMatch[2];
      const activeConfig = gameConfig.rounds[currentRoundIndex - 1]!;
      const state = roundStates.get(activeConfig.roundId)!;

      if (method === "GET" && !action) {
        await fulfillJson(route, 200, roundView(state));
        return;
      }

      if (method === "POST" && action === "/hint") {
        if (state.hintsRevealedCount < state.config.maxHints) state.hintsRevealedCount += 1;
        await fulfillJson(route, 200, roundView(state));
        return;
      }

      if (method === "POST" && action === "/guess") {
        const body = request.postDataJSON() as { choiceId: string };
        if (state.status === "active") {
          if (body.choiceId === state.config.correctChoiceId) {
            state.status = "resolved_correct";
            state.scoreAwarded = availableScore(state.hintsRevealedCount, state.wrongGuessCount);
          } else {
            state.wrongGuessCount += 1;
          }
        }
        await fulfillJson(route, 200, roundView(state));
        return;
      }
    }

    if (method === "POST" && pathname.match(/^\/games\/[^/]+\/advance$/)) {
      const resolvedConfig = gameConfig.rounds[currentRoundIndex - 1]!;
      const resolvedState = roundStates.get(resolvedConfig.roundId)!;
      totalScore += resolvedState.scoreAwarded ?? 0;

      if (currentRoundIndex >= gameConfig.totalRounds) {
        gameStatus = "completed";
        await fulfillJson(route, 200, { completed: true, game: gameView() });
        return;
      }

      currentRoundIndex += 1;
      const nextConfig = gameConfig.rounds[currentRoundIndex - 1]!;
      const nextState = roundStates.get(nextConfig.roundId)!;
      await fulfillJson(route, 200, { completed: false, game: gameView(), round: roundView(nextState) });
      return;
    }

    if (method === "GET" && pathname.match(/^\/games\/[^/]+\/results$/)) {
      await fulfillJson(route, 200, { ...gameView(), shareUrl: gameStatus === "completed" ? `/guess/results/${gameConfig.shareToken}` : null });
      return;
    }

    if (method === "GET" && pathname === `/results/${gameConfig.shareToken}`) {
      if (gameStatus !== "completed") {
        await fulfillError(route, 404, "not_found");
        return;
      }
      await fulfillJson(route, 200, { mode: gameConfig.mode, totalScore, totalRounds: gameConfig.totalRounds, completedAt: new Date().toISOString() });
      return;
    }

    await fulfillError(route, 404, "not_found");
  });

  return {
    failNext(pathSuffix, status, code, retryAfterSeconds) {
      const queue = pendingFailures.get(pathSuffix) ?? [];
      queue.push({ status, code, retryAfterSeconds });
      pendingFailures.set(pathSuffix, queue);
    },
    setOffline(value) {
      offline = value;
    },
    requestLog,
  };
}

/** Two rounds: round 1 exercises a hint + a wrong guess before the correct answer; round 2 resolves immediately. Includes a long mixed Hebrew/English username to exercise bidi wrapping. */
export function defaultGameConfig(overrides?: Partial<MockGameConfig>): MockGameConfig {
  return {
    gameId: "game-fixture-1",
    mode: "daily",
    totalRounds: 2,
    shareToken: "share-fixture-token",
    rounds: [
      {
        roundId: "round-1",
        orderInGame: 1,
        maxHints: 3,
        posts: [
          "אני חושב שכולנו צריכים לנשום עמוק לפני שממשיכים בדיון הזה, יש כאן כמה נקודות מעניינות.",
          "בנוסף, כדאי לבדוק את התיעוד הרשמי לפני שמסיקים מסקנות - חלק מהמידע כאן כבר לא מעודכן.",
          "תודה לכולם על הסבלנות, ננסה לסכם את הנושא בפוסט הבא בצורה מסודרת יותר.",
        ],
        choices: [
          { choiceId: "c1", username: "דניאל_כהן" },
          { choiceId: "c2", username: "Jonathan_Builds_Things_מפתח" },
          { choiceId: "c3", username: "מיכל99" },
          { choiceId: "c4", username: "TechGuy_ישראל" },
        ],
        correctChoiceId: "c2",
      },
      {
        roundId: "round-2",
        orderInGame: 2,
        maxHints: 2,
        posts: ["מישהו יכול להסביר איך זה עובד? ניסיתי כמה פעמים ולא הצלחתי להבין את ההיגיון מאחורי זה."],
        choices: [
          { choiceId: "c5", username: "אורית_ל" },
          { choiceId: "c6", username: "נועה שפירא" },
          { choiceId: "c7", username: "David_K" },
          { choiceId: "c8", username: "רון_מ" },
        ],
        correctChoiceId: "c7",
      },
    ],
    ...overrides,
  };
}
