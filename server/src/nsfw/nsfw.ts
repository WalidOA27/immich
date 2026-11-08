import { LAION_CLIP_B32 } from 'src/nsfw/laion-clip-b32.weights.js';

export const NSFW_METADATA_KEY = 'nsfw';
export const NSFW_MODEL = 'laion-clip-b32';
export const NSFW_VERSION = 1;
export const NSFW_CLIP_MODEL = 'ViT-B-32__openai';
export const NSFW_EMBEDDING_DIM = 512;
export const DEFAULT_NSFW_THRESHOLD = 0.5;

export type NsfwMetadata = { score: number; model: string; v: number };

type Weights = { [K in keyof typeof LAION_CLIP_B32]: Float32Array };

let weights: Weights | undefined;

const decode = (base64: string) => {
  const bytes = Buffer.from(base64, 'base64');
  const out = new Float32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) {
    out[i] = bytes.readFloatLE(i * 4);
  }
  return out;
};

const getWeights = (): Weights => {
  if (!weights) {
    weights = Object.fromEntries(
      Object.entries(LAION_CLIP_B32).map(([key, { data }]) => [key, decode(data)]),
    ) as Weights;
  }
  return weights;
};

/** Dense layer: kernel is row-major [inputs, outputs] (Keras layout). */
const dense = (input: ArrayLike<number>, kernel: Float32Array, bias: Float32Array, relu: boolean) => {
  const outputs = bias.length;
  const result = new Float64Array(outputs);
  for (let o = 0; o < outputs; o++) {
    let sum = bias[o];
    for (let i = 0; i < input.length; i++) {
      sum += input[i] * kernel[i * outputs + o];
    }
    result[o] = relu ? Math.max(sum, 0) : sum;
  }
  return result;
};

export const parseEmbedding = (embedding: string | number[]): Float32Array =>
  Float32Array.from(typeof embedding === 'string' ? (JSON.parse(embedding) as number[]) : embedding);

/** LAION CLIP-based NSFW detector (ViT-B/32 head): returns a score between 0 and 1 (1 = NSFW). */
export const scoreNsfw = (embedding: Float32Array): number => {
  if (embedding.length !== NSFW_EMBEDDING_DIM) {
    throw new Error(`Expected a ${NSFW_EMBEDDING_DIM}-dimensional embedding, got ${embedding.length}`);
  }
  const w = getWeights();
  const normalized = new Float64Array(NSFW_EMBEDDING_DIM);
  for (let i = 0; i < NSFW_EMBEDDING_DIM; i++) {
    normalized[i] = (embedding[i] - w.mean[i]) / Math.sqrt(Math.max(w.variance[i], 1e-7));
  }
  const hidden1 = dense(normalized, w.dense1Kernel, w.dense1Bias, true);
  const hidden2 = dense(hidden1, w.dense2Kernel, w.dense2Bias, true);
  const [logit] = dense(hidden2, w.dense3Kernel, w.dense3Bias, false);
  return 1 / (1 + Math.exp(-logit));
};

/** Reads IMMICH_NSFW_THRESHOLD; invalid or out-of-range values fall back to the default. */
export const getNsfwThreshold = (env: NodeJS.ProcessEnv = process.env): number => {
  const raw = env.IMMICH_NSFW_THRESHOLD?.trim();
  if (!raw) {
    return DEFAULT_NSFW_THRESHOLD;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : DEFAULT_NSFW_THRESHOLD;
};
