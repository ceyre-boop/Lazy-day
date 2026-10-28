import type { SourceAdapter } from './types.ts'
import { livoniaAdapter } from './livonia.ts'

/** Register new local-calendar adapters here. */
export const adapters: SourceAdapter[] = [livoniaAdapter]
