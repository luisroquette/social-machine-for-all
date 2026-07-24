/**
 * Robust JSON parser for AI responses.
 * Handles markdown code blocks, extra text around JSON, and malformed responses.
 */

export class AIJsonParseError extends Error {
  constructor(
    message: string,
    public readonly rawText: string
  ) {
    super(message)
    this.name = 'AIJsonParseError'
  }
}

/**
 * Parse JSON from AI model output, handling common formatting issues.
 *
 * Tries in order:
 * 1. Strip markdown ```json blocks
 * 2. Direct JSON.parse
 * 3. Extract JSON array/object with regex
 * 4. Throw with raw text for debugging
 */
export function parseAIJson<T = unknown>(
  text: string,
  label = 'AI response'
): T {
  if (!text || text.trim().length === 0) {
    throw new AIJsonParseError(`${label}: Empty response`, text)
  }

  // Step 1: Remove markdown code blocks
  const cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()

  // Step 2: Try direct parse
  try {
    return JSON.parse(cleaned) as T
  } catch {
    // Continue to next strategy
  }

  // Step 3: Try to extract JSON array [...] or object {...}
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]) as T
    } catch {
      // Continue
    }
  }

  const objectMatch = cleaned.match(/\{[\s\S]*\}/)
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]) as T
    } catch {
      // Continue
    }
  }

  // Step 4: All strategies failed
  console.error(`[parse-json] ${label} — Failed to parse. Raw text (first 500 chars):`, text.slice(0, 500))
  throw new AIJsonParseError(
    `${label}: Could not parse JSON from AI response`,
    text.slice(0, 1000)
  )
}

/**
 * Parse AI JSON with validation function.
 * Returns null instead of throwing on validation failure.
 */
export function parseAIJsonSafe<T>(
  text: string,
  validate: (obj: unknown) => obj is T,
  label = 'AI response'
): T | null {
  try {
    const parsed = parseAIJson(text, label)
    if (validate(parsed)) return parsed
    console.warn(`[parse-json] ${label} — Parsed but validation failed`)
    return null
  } catch {
    return null
  }
}
