import { sql } from 'kysely';
import { NSFW_METADATA_KEY } from 'src/nsfw/nsfw.js';

/**
 * True when the asset in scope (`asset`) has an `nsfw` metadata row whose numeric score is >= threshold.
 * Malformed values (non-numeric score) count as not NSFW instead of failing the query; CASE fixes the evaluation
 * order and numeric has no range limit (a real cast fails on e.g. 1e39).
 */
export const isNsfwAsset = (threshold: number) =>
  sql<boolean>`exists (
    select 1 from asset_metadata nsfw_meta
    where nsfw_meta."assetId" = asset.id
      and nsfw_meta.key = ${NSFW_METADATA_KEY}
      and case
        when jsonb_typeof(nsfw_meta.value->'score') = 'number' then (nsfw_meta.value->'score')::numeric >= ${threshold}
        else false
      end
  )`;
