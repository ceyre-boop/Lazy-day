import Anthropic from '@anthropic-ai/sdk'
import type { AiMessage, MessageRunner } from './adapter.ts'

/** Real runner: streams (large max_tokens + server tools can run for minutes) and returns the final message. */
export function createAnthropicRunner(apiKey: string): MessageRunner {
  const client = new Anthropic({ apiKey })
  return async (params) => {
    const stream = client.messages.stream(params as never)
    return (await stream.finalMessage()) as unknown as AiMessage
  }
}
