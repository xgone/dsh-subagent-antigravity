import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const AgyStreamSessionRecord = z.object({
  // The CLI reports its conversation id only after the first turn's `init`
  // event, so a freshly spawned child has no id yet.
  conversationId: z.string().min(1).optional(),
  lastDshMessageId: z.string().min(1).optional(),
  promptInFlight: z.boolean(),
})

/**
 * Durable sidecar mapping from a DSH child Session to its native `agy`
 * conversation. A disposed child reopens the same CLI conversation with
 * `--conversation`, so a response the model already delivered is never rerun.
 */
export const STREAM_SESSION_DOMAIN_SPEC = defineDomain({
  name: 'xgone_antigravity_stream_sessions',
  version: 0,
  tables: {
    sessions: domainTable(AgyStreamSessionRecord),
  },
})