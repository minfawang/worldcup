import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSchedule } from "@/lib/scheduleCache";
import { isModelKey, resolveModel } from "@/lib/models";
import { getPrediction, setPrediction } from "@/lib/predictionCache";
import { LANG_NAME, type Lang } from "@/lib/i18n";
import { findMatch, type Schedule, type WCMatch } from "@/lib/worldcup";

export const dynamic = "force-dynamic";

interface PredictBody {
  matchId?: number;
  model?: string;
  lang?: string;
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
  const langNote = `\nWrite the "reasoning" field in ${LANG_NAME[lang]}. Keep the "winner" field exactly as one of the provided team-name options (do not translate it).`;

  return [
    `You are a football (soccer) analyst predicting a 2026 FIFA World Cup match.`,
    ``,
    `Match: ${match.team1} vs ${match.team2}`,
    `Stage: ${stageLabel}`,
    `Date: ${match.date} at ${match.ground || "TBD"}`,
    ``,
    `Recent tournament form:`,
    `- ${match.team1}: ${recentForm(schedule, match.team1, match.id)}`,
    `- ${match.team2}: ${recentForm(schedule, match.team2, match.id)}`,
    knockoutNote,
    langNote,
    ``,
    `Predict the final scoreline and explain your reasoning in 3-5 sentences,`,
    `referencing team strengths, form, and any tactical factors. Then submit your`,
    `prediction using the submit_prediction tool.`,
  ].join("\n");
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
  const cachedPrediction = getPrediction(body.matchId, modelKey, lang);
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

  try {
    const response = await anthropic.messages.create({
      model: model.id,
      max_tokens: 1024,
      tools: [
        {
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
            },
            required: ["score1", "score2", "winner", "confidence", "reasoning"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "submit_prediction" },
      messages: [{ role: "user", content: buildPrompt(schedule, match, lang) }],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (!toolUse) {
      return NextResponse.json(
        { error: "The model did not return a structured prediction. Try again." },
        { status: 502 },
      );
    }

    const prediction = toolUse.input as {
      score1: number;
      score2: number;
      winner: string;
      confidence: number;
      reasoning: string;
    };

    const result = {
      matchId: match.id,
      model: { key: model.key, label: model.label, id: model.id },
      team1: match.team1,
      team2: match.team2,
      prediction,
    };

    setPrediction(match.id, modelKey, lang, result);

    return NextResponse.json({ ...result, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status =
      err instanceof Anthropic.APIError && typeof err.status === "number" ? err.status : 502;
    return NextResponse.json({ error: `Prediction failed: ${message}` }, { status });
  }
}
