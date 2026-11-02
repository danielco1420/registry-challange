/**
 * Turns a failed Valibot parse into a 400 JSON response.
 *
 * Works in loaders and resource routes: `parseOrThrow` throws the `Response`,
 * which React Router returns as-is from a resource route and hands to the
 * error boundary from a page loader. Client-safe (only web standard APIs).
 */
import * as v from 'valibot';

export interface ParamIssue {
  /** Dot path of the offending param, e.g. `page` or `ns`. */
  param: string;
  message: string;
}

export interface BadRequestBody {
  error: {
    code: 'invalid_params';
    message: string;
    issues: ParamIssue[];
  };
}

/** Converts Valibot issues into our public shape. Messages come from our schemas, never the input. */
export function toParamIssues(issues: readonly v.BaseIssue<unknown>[]): ParamIssue[] {
  return issues.map((issue) => ({
    param: v.getDotPath(issue) ?? '',
    message: issue.message,
  }));
}

/** A `400 Bad Request` JSON response. Never cached. */
export function badRequest(issues: ParamIssue[]): Response {
  const body: BadRequestBody = {
    error: { code: 'invalid_params', message: 'Invalid request parameters', issues },
  };
  return Response.json(body, {
    status: 400,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; response: Response };

/** Parses `input`; on failure returns the 400 response instead of throwing. */
export function parseParams<const TSchema extends v.GenericSchema>(
  schema: TSchema,
  input: unknown,
): ParseResult<v.InferOutput<TSchema>> {
  const result = v.safeParse(schema, input);
  if (result.success) return { ok: true, value: result.output };
  return { ok: false, response: badRequest(toParamIssues(result.issues)) };
}

/** Parses `input` or throws a 400 `Response`. */
export function parseOrThrow<const TSchema extends v.GenericSchema>(
  schema: TSchema,
  input: unknown,
): v.InferOutput<TSchema> {
  const result = parseParams(schema, input);
  if (!result.ok) throw result.response;
  return result.value;
}
