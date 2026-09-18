import { z } from 'zod'
import { badRequest } from '../errors.ts'

/**
 * Query parsing has to tolerate what real clients send. Two shapes matter:
 *
 *   ?q=                   a form submitted with an empty field
 *   ?company=a&company=b  the standard repeated-key multi-value form
 *
 * The first means "no filter", not an error. The second arrives as an array.
 */
export const blankToUndefined = (value: unknown) =>
  value === '' || (Array.isArray(value) && value.length === 0) ? undefined : value

/** Accepts repeated keys, comma-separated values, or both. */
export const stringList = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => {
    const parts = (Array.isArray(value) ? value : [value])
      .flatMap((part) => part.split(','))
      .map((part) => part.trim())
      .filter(Boolean)
    return parts.length ? parts : undefined
  })

export const searchTerm = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? (value[0] ?? '') : value).trim())
  .refine((value) => value.length <= 100, 'must be at most 100 characters')
  .transform((value) => (value.length ? value : undefined))

/**
 * .optional() belongs *inside* the preprocess. An outer optional tests the raw
 * input, and '' is not undefined, so it never short-circuits — the inner schema
 * then receives the preprocessed undefined and coerces it to NaN.
 */
export const optionalPage = z.preprocess(
  blankToUndefined,
  z.coerce.number().int().min(1).max(10_000).optional()
)

export const optionalPerPage = (max: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(max).optional())

export const slugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9-]+$/, 'must be a lowercase slug')

export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`)
      .join('; ')
    throw badRequest(detail, 'validation_failed')
  }
  return result.data
}
