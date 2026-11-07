import type { SourceAdapter } from './types.ts'
import { livoniaAdapter } from './livonia.ts'
import { westlandAdapter } from './westland.ts'

/** Register new local-calendar adapters here. */
export const adapters: SourceAdapter[] = [livoniaAdapter, westlandAdapter]
