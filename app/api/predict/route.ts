import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSchedule } from "@/lib/scheduleCache";
import { isModelKey, resolveModel } from "@/lib/models";
import { getPrediction, setPrediction, normalizeKeyFactors } from "@/lib/predictionCache";
import { LANG_NAME, type Lang } from "@/lib/i18n";
import { findMatch, type Schedule, type WCMatch } from "@/lib/worldcup";

export const dynamic = "force-dynamic";

interface PredictBody {
  matchId?: number;
  model?: string;
  lang?: string;
}

// Read-only lookup: returns a cached prediction if one exists, without ever
// calling Claude. Used by the UI to auto-display saved predictions on open.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const matchId = Number(searchParams.get("matchId"));
  const model = searchParams.get("model");
  const lang: Lang = searchParams.get("lang") === "zh" ? "zh" : "en";

  if (!Number.isInteger(matchId) || !isModelKey(model)) {
    return NextResponse.json({ cached: false }, { status: 200 });
  }

  const cached = await getPrediction(matchId, model, lang);
  if (cached) {
    return NextResponse.json({ ...cached, cached: true });
  }
  return NextResponse.json({ cached: false });
}

function recentForm(schedule: Schedule, team: string, exceptId: number): string {
  const games = schedule.matches
    .filter(
      (m) =>
        m.status === "played" &&
        m.id !== exceptId &&
        (m.team1 === team || m.team2 === team),
    )
    .slice(-4);

  if (games.length === 0) return "no matches played yet in this tournament";

  return games
    .map((m) => {
      const isHome = m.team1 === team;
      const opp = isHome ? m.team2 : m.team1;
      const gf = isHome ? m.score1 : m.score2;
      const ga = isHome ? m.score2 : m.score1;
      const res = gf! > ga! ? "W" : gf! < ga! ? "L" : "D";
      return `${res} ${gf}-${ga} vs ${opp}`;
    })
    .join("; ");
}

function buildPrompt(schedule: Schedule, match: WCMatch, lang: Lang): string {
  const stageLabel = match.stage === "group" ? `group stage (${match.group})` : match.round;
  const knockoutNote =
    match.stage === "knockout"
      ? "\nThis is a knockout match, so it cannot end in a draw. If regulation time is level, decide the winner via extra time or a penalty shootout and say so in your reasoning (the winner field must be a team, not \"Draw\")."
      : "";
  const langNote = `\nWrite every free-text field ("reasoning", "headToHead", "keyPlayers1", "keyPlayers2", and each item of "keyFactors") in ${LANG_NAME[lang]}. Keep the "winner" field exactly as one of the provided team-name options (do not translate it).`;

  return [
    `You are a football (soccer) analyst predicting a 2026 FIFA World Cup match.`,
    ``,
    `Match: ${match.team1} vs ${match.team2}`,
    `Stage: ${stageLabel}`,
    `Date: ${match.date} at ${match.ground || "TBD"}`,
    ``,
    `Recent tournament form (from this tournament's played matches):`,
    `- ${match.team1}: ${recentForm(schedule, match.team1, match.id)}`,
    `- ${match.team2}: ${recentForm(schedule, match.team2, match.id)}`,
    ``,
    `Use the web_search tool to research current, real-world information before predicting. Search for:`,
    `- The latest FIFA world rankings for both teams`,
    `- Recent head-to-head results between the two teams`,
    `- Current injuries, suspensions, and key player availability for both squads`,
    `- Any recent form or news beyond the tournament matches listed above`,
    `Run a few focused searches, then base your analysis on what you find.`,
    knockoutNote,
    langNote,
    ``,
    `When done researching, call the submit_prediction tool with the final scoreline,`,
    `a 3-5 sentence reasoning, the FIFA rankings you found, a short head-to-head summary,`,
    `each team's key players / availability, and 2-4 concise key factors. If you could not`,
    `confirm a value (e.g. a ranking), leave that specific field out rather than guessing.`,
  ].join("\n");
}

interface Source {
  title: string;
  url: string;
}

// Pull unique web-search sources out of the assistant content blocks so the UI
// can show where the analysis came from.
function collectSources(blocks: Anthropic.ContentBlock[], into: Map<string, Source>): void {
  for (const block of blocks) {
    if (block.type !== "web_search_tool_result") continue;
    const content = (block as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (
        item &&
        typeof item === "object" &&
        (item as { type?: string }).type === "web_search_result"
      ) {
        const url = (item as { url?: string }).url;
        const title = (item as { title?: string }).title;
        if (url && !into.has(url)) {
          into.set(url, { title: title || url, url });
        }
      }
    }
  }
}

export async function POST(request: Request) {
  let body: PredictBody;
  try {
    body = (await request.json()) as PredictBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.matchId !== "number") {
    return NextResponse.json({ error: "matchId (number) is required." }, { status: 400 });
  }
  if (!isModelKey(body.model)) {
    return NextResponse.json(
      { error: 'model must be "sonnet" or "opus".' },
      { status: 400 },
    );
  }
  const modelKey = body.model;
  const lang: Lang = body.lang === "zh" ? "zh" : "en";

  // Return a previously computed prediction for this match + model + language
  // without calling Claude again.
  const cachedPrediction = await getPrediction(body.matchId, modelKey, lang);
  if (cachedPrediction) {
    return NextResponse.json({ ...cachedPrediction, cached: true });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "ANTHROPIC_API_KEY is not configured. Add it to .env.local to enable predictions.",
      },
      { status: 503 },
    );
  }

  let schedule: Schedule;
  try {
    ({ schedule } = await getSchedule(false));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Could not load schedule. ${message}` }, { status: 502 });
  }

  const match = findMatch(schedule, body.matchId);
  if (!match) {
    return NextResponse.json({ error: "Match not found." }, { status: 404 });
  }
  if (match.team1Placeholder || match.team2Placeholder) {
    return NextResponse.json(
      { error: "This match's teams are not decided yet, so it cannot be predicted." },
      { status: 409 },
    );
  }

  const model = resolveModel(modelKey);
  const anthropic = new Anthropic({ apiKey });

  const winnerEnum =
    match.stage === "knockout"
      ? [match.team1, match.team2]
      : [match.team1, match.team2, "Draw"];

  const submitTool: Anthropic.Tool = {
    name: "submit_prediction",
    description: "Submit the predicted result of the match.",
    input_schema: {
      type: "object",
      properties: {
        score1: {
          type: "integer",
          minimum: 0,
          description: `Predicted goals for ${match.team1}`,
        },
        score2: {
          type: "integer",
          minimum: 0,
          description: `Predicted goals for ${match.team2}`,
        },
        winner: {
          type: "string",
          enum: winnerEnum,
          description: "The team you expect to advance/win, or Draw for group games.",
        },
        confidence: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          description: "Confidence in this prediction, 0-100.",
        },
        reasoning: {
          type: "string",
          description: "3-5 sentence explanation of the prediction.",
        },
        team1Ranking: {
          type: "integer",
          minimum: 1,
          description: `Current FIFA world ranking for ${match.team1}. Omit if unknown.`,
        },
        team2Ranking: {
          type: "integer",
          minimum: 1,
          description: `Current FIFA world ranking for ${match.team2}. Omit if unknown.`,
        },
        headToHead: {
          type: "string",
          description:
            "Short summary of recent head-to-head results between the two teams. Omit if unknown.",
        },
        keyPlayers1: {
          type: "string",
          description: `Key players and injury/suspension availability for ${match.team1}. Omit if unknown.`,
        },
        keyPlayers2: {
          type: "string",
          description: `Key players and injury/suspension availability for ${match.team2}. Omit if unknown.`,
        },
        keyFactors: {
          type: "array",
          items: { type: "string" },
          description: "2-4 concise bullet points on the decisive factors for this match.",
        },
      },
      required: ["score1", "score2", "winner", "confidence", "reasoning"],
    },
  };

  const webSearchTool = {
    type: "web_search_20250305" as const,
    name: "web_search",
    max_uses: 5,
  };

  const tools = [webSearchTool, submitTool] as Anthropic.ToolUnion[];

  const encoder = new TextEncoder();

  // Stream progress as newline-delimited JSON so the UI can show each research
  // step (web searches) live while the model works, then the final result.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      const messages: Anthropic.MessageParam[] = [
        { role: "user", content: buildPrompt(schedule, match, lang) },
      ];
      const sources = new Map<string, Source>();

      // Run one streaming turn, emitting a progress event for every web search
      // the model issues, and return the fully assembled message.
      const runTurn = async (
        turnTools: Anthropic.ToolUnion[],
        toolChoice?: Anthropic.MessageCreateParams["tool_choice"],
      ): Promise<Anthropic.Message> => {
        const s = anthropic.messages.stream({
          model: model.id,
          max_tokens: 2048,
          tools: turnTools,
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
          messages,
        });

        let blockType: string | null = null;
        let blockName: string | null = null;
        let blockJson = "";
        for await (const ev of s) {
          if (ev.type === "content_block_start") {
            blockType = ev.content_block.type;
            blockName =
              "name" in ev.content_block ? (ev.content_block.name as string) : null;
            blockJson = "";
          } else if (
            ev.type === "content_block_delta" &&
            ev.delta.type === "input_json_delta"
          ) {
            blockJson += ev.delta.partial_json;
          } else if (ev.type === "content_block_stop") {
            if (blockType === "server_tool_use" && blockName === "web_search") {
              try {
                const query = (JSON.parse(blockJson) as { query?: string }).query;
                if (query) send({ type: "search", query });
              } catch {
                // Ignore unparseable partial tool input.
              }
            }
            blockType = null;
            blockName = null;
            blockJson = "";
          }
        }
        return s.finalMessage();
      };

      try {
        send({ type: "status", stage: "researching" });

        let response = await runTurn(tools);
        collectSources(response.content, sources);

        // The web-search server tool can pause the turn while it runs; feed the
        // partial turn back until the model finishes its research and answers.
        let guard = 0;
        while (response.stop_reason === "pause_turn" && guard < 6) {
          messages.push({ role: "assistant", content: response.content });
          response = await runTurn(tools);
          collectSources(response.content, sources);
          guard += 1;
        }

        let toolUse = response.content.find(
          (block): block is Anthropic.ToolUseBlock =>
            block.type === "tool_use" && block.name === "submit_prediction",
        );

        send({ type: "status", stage: "finalizing" });

        // If the model researched but stopped without submitting, ask it to submit.
        if (!toolUse) {
          messages.push({ role: "assistant", content: response.content });
          messages.push({
            role: "user",
            content: "Now submit your prediction using the submit_prediction tool.",
          });
          response = await runTurn([submitTool], {
            type: "tool",
            name: "submit_prediction",
          });
          toolUse = response.content.find(
            (block): block is Anthropic.ToolUseBlock =>
              block.type === "tool_use" && block.name === "submit_prediction",
          );
        }

        if (!toolUse) {
          send({
            type: "error",
            error: "The model did not return a structured prediction. Try again.",
          });
          return;
        }

        const raw = toolUse.input as {
          score1: number;
          score2: number;
          winner: string;
          confidence: number;
          reasoning: string;
          team1Ranking?: number;
          team2Ranking?: number;
          headToHead?: string;
          keyPlayers1?: string;
          keyPlayers2?: string;
          keyFactors?: unknown;
        };

        // Normalize keyFactors into a clean string[] (handles single-string and
        // <item>-tag-packed shapes the model sometimes returns).
        const keyFactors = normalizeKeyFactors(raw.keyFactors);

        const prediction = { ...raw, keyFactors };

        const result = {
          matchId: match.id,
          model: { key: model.key, label: model.label, id: model.id },
          team1: match.team1,
          team2: match.team2,
          prediction,
          sources: Array.from(sources.values()).slice(0, 8),
        };

        await setPrediction(match.id, modelKey, lang, result);

        send({ type: "result", result: { ...result, cached: false } });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        send({ type: "error", error: `Prediction failed: ${message}` });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
