import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

/**
 * The last successfully read quota snapshot, stored as JSON text so the stored
 * shape can never disagree with the reader's normalized snapshot schema.
 */
const QuotaSnapshotRecord = z.object({
  json: z.string().min(1),
})

/**
 * Durable cache for the composer quota reading. A Host restart loses the
 * in-memory cache; this sidecar lets the pill render the previous reading with a
 * staleness marker while a fresh CLI probe runs in the background.
 */
export const QUOTA_DOMAIN_SPEC = defineDomain({
  name: 'xgone_antigravity_quota',
  version: 0,
  tables: {
    snapshot: domainTable(QuotaSnapshotRecord),
  },
})