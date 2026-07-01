export type ModelKey = "sonnet" | "opus";

export interface ModelOption {
  key: ModelKey;
  label: string;
  description: string;
  /** Concrete Anthropic API model ID. Configurable via env. */
  id: string;
}

// Defaults track the current Claude model IDs and can be overridden via env
// so the app keeps working as new models ship.
export const MODELS: Record<ModelKey, ModelOption> = {
  sonnet: {
    key: "sonnet",
    label: "Claude Sonnet",
    description: "Fast, balanced predictions",
    id: process.env.CLAUDE_SONNET_MODEL ?? "claude-sonnet-5",
  },
  opus: {
    key: "opus",
    label: "Claude Opus",
    description: "Deepest reasoning",
    id: process.env.CLAUDE_OPUS_MODEL ?? "claude-opus-4-8",
  },
};

export function isModelKey(value: unknown): value is ModelKey {
  return value === "sonnet" || value === "opus";
}

export function resolveModel(key: ModelKey): ModelOption {
  return MODELS[key];
}

/** Client-safe list (labels only, no server env details needed for the UI). */
export const MODEL_LIST: Array<Pick<ModelOption, "key" | "label" | "description">> =
  Object.values(MODELS).map(({ key, label, description }) => ({
    key,
    label,
    description,
  }));
