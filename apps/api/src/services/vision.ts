/**
 * Camera scanning: hand Claude a photo of groceries, get back a list of items.
 *
 * This is the half of scanning that barcodes cannot do — loose produce, bulk
 * bags, a whole counter of shopping at once. The model's output is always
 * treated as a *proposal*: every candidate goes to a human for confirmation
 * before it touches inventory (DECISIONS.md D-006).
 */

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { CATEGORIES, UNIT_CODES, type Category, type UnitCode } from '@pantry/shared'

export interface VisionImage {
  /** Base64 with no data-URI prefix and no newlines. */
  data: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
}

export interface VisionItem {
  name: string
  brand: string | null
  category: Category
  quantity: number
  unit: UnitCode
  confidence: number
}

export interface VisionProvider {
  readonly available: boolean
  identify(images: readonly VisionImage[], hint?: string): Promise<VisionItem[]>
}

export class VisionError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'VisionError'
  }
}

const visionItemSchema = z.object({
  name: z.string().describe('The product as a person would write it on a list, e.g. "Bananas"'),
  brand: z.string().nullable().describe('Brand if clearly legible, otherwise null'),
  category: z.enum(CATEGORIES),
  quantity: z.number().describe('How many, or the net weight/volume if shown on the package'),
  unit: z.enum(UNIT_CODES),
  confidence: z.number().min(0).max(1).describe('0 to 1 — how sure you are of this item'),
})

const visionResultSchema = z.object({
  items: z.array(visionItemSchema),
})

const SYSTEM_PROMPT = `You identify groceries in photographs for a household inventory app.

Return one entry per distinct product you can see. Rules:
- Count duplicates rather than repeating them: six identical yogurt cups are one entry with quantity 6, unit "each".
- If a package states its net contents, use that: a 2 lb bag of rice is quantity 2, unit "lb".
- Use "each" for whole items you are counting, and the packaging unit ("can", "bag", "box", "bottle", "jar") when the container is the natural way to count it.
- Name things plainly and generically. "Bananas", not "a bunch of ripe yellow bananas".
- Set brand only when you can actually read it on the label. Never guess a brand from packaging colour.
- Confidence should reflect real uncertainty. A partly hidden item behind others is low confidence; a clearly visible labelled box is high.
- Omit anything that is not a grocery: hands, phones, counters, bags, pets, packaging that has been discarded.
- If you cannot identify any groceries, return an empty list. Do not invent plausible items.`

export interface ClaudeVisionOptions {
  apiKey: string
  model: string
  maxImageBytes: number
  client?: Anthropic
}

export function createClaudeVisionProvider(options: ClaudeVisionOptions): VisionProvider {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey })

  return {
    available: true,
    async identify(images, hint) {
      if (images.length === 0) throw new VisionError('No image supplied', false)

      for (const image of images) {
        // Base64 inflates by 4/3; compare against the decoded size.
        const bytes = Math.floor((image.data.length * 3) / 4)
        if (bytes > options.maxImageBytes) {
          throw new VisionError('That photo is too large — try a lower-resolution shot', false)
        }
      }

      const content: Anthropic.ContentBlockParam[] = images.map((image) => ({
        type: 'image',
        source: { type: 'base64', media_type: image.mediaType, data: image.data },
      }))
      content.push({
        type: 'text',
        text: hint?.trim()
          ? `List the groceries in these photos. Extra context from the person who took them: ${hint.trim()}`
          : 'List the groceries in these photos.',
      })

      try {
        const response = await client.messages.parse({
          model: options.model,
          max_tokens: 16000,
          system: SYSTEM_PROMPT,
          thinking: { type: 'adaptive' },
          output_config: {
            effort: 'medium',
            format: zodOutputFormat(visionResultSchema),
          },
          messages: [{ role: 'user', content }],
        })

        // A refusal arrives as a normal 200, so it has to be checked explicitly.
        if (response.stop_reason === 'refusal') {
          throw new VisionError('Claude declined to describe that photo', false)
        }
        if (response.stop_reason === 'max_tokens') {
          throw new VisionError(
            'That photo had too much in it \u2014 try scanning in batches',
            false,
          )
        }

        const parsed = response.parsed_output
        if (!parsed) throw new VisionError('Claude returned something unreadable', true)

        return parsed.items
          .filter((item) => item.name.trim() !== '' && item.quantity > 0)
          .map((item) => ({
            name: item.name.trim(),
            brand: item.brand?.trim() ? item.brand.trim() : null,
            category: item.category,
            quantity: item.quantity,
            unit: item.unit,
            confidence: Math.min(1, Math.max(0, item.confidence)),
          }))
      } catch (error) {
        if (error instanceof VisionError) throw error
        if (error instanceof Anthropic.RateLimitError) {
          throw new VisionError(
            'Claude is rate-limited right now \u2014 try again in a moment',
            true,
          )
        }
        if (error instanceof Anthropic.AuthenticationError) {
          throw new VisionError('The Anthropic API key was rejected', false)
        }
        if (error instanceof Anthropic.APIError) {
          const status = error.status ?? 0
          throw new VisionError(`Claude could not read the photo (${status})`, status >= 500)
        }
        throw new VisionError('Could not reach Claude', true)
      }
    },
  }
}

/**
 * Stands in when no API key is configured. Scanning by photo is then simply
 * unavailable — barcodes, and everything else, keep working.
 */
export const unavailableVisionProvider: VisionProvider = {
  available: false,
  identify: () => {
    throw new VisionError(
      'Photo scanning is off. Set ANTHROPIC_API_KEY on the server to turn it on.',
      false,
    )
  },
}
