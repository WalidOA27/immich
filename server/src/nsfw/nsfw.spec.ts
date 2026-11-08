import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_NSFW_THRESHOLD, getNsfwThreshold, parseEmbedding, scoreNsfw } from 'src/nsfw/nsfw.js';

const fixture = JSON.parse(readFileSync(new URL('nsfw.fixture.json', import.meta.url), 'utf8')) as {
  cases: Array<{ embedding: number[]; score: number }>;
};

describe('scoreNsfw', () => {
  it('matches the numpy reference scores', () => {
    expect(fixture.cases.map((c) => Number(c.score.toFixed(2)))).toEqual([0.02, 0.2, 0.5, 0.8, 0.98]);
    for (const c of fixture.cases) {
      expect(scoreNsfw(Float32Array.from(c.embedding))).toBeCloseTo(c.score, 4);
    }
  });

  it('rejects embeddings that are not 512-dimensional', () => {
    expect(() => scoreNsfw(new Float32Array(768))).toThrow();
  });
});

describe('parseEmbedding', () => {
  it('parses pgvector text', () => {
    expect(parseEmbedding('[1,2.5,-3]')).toEqual(Float32Array.from([1, 2.5, -3]));
  });

  it('accepts a number array', () => {
    expect(parseEmbedding([1, 2])).toEqual(Float32Array.from([1, 2]));
  });
});

describe('getNsfwThreshold', () => {
  it('reads the threshold from the environment', () => {
    expect(getNsfwThreshold({ IMMICH_NSFW_THRESHOLD: '0.37' })).toBe(0.37);
  });

  it('defaults to 0.5 when unset', () => {
    expect(DEFAULT_NSFW_THRESHOLD).toBe(0.5);
    expect(getNsfwThreshold({})).toBe(0.5);
  });

  it.each(['abc', '-1', '2', '', ' '])('falls back to the default for invalid value %j', (value) => {
    expect(getNsfwThreshold({ IMMICH_NSFW_THRESHOLD: value })).toBe(0.5);
  });
});
