/**
 * A tiny Result type.
 *
 * Used at layer boundaries (services, repositories, adapters) where a failure is
 * an expected outcome rather than a bug — a missing record, a rejected
 * approval, an upstream provider being down. Genuine programmer errors still
 * throw. This keeps "expected failure" out of the exception channel, where it
 * tends to get swallowed by a catch-all somewhere up the stack.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = JarvisError> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** Unwraps a result, throwing on failure. Only for tests and trusted callers. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw new Error(`Attempted to unwrap a failed Result: ${JSON.stringify(result.error)}`);
}

export const errorKinds = [
  "not_found",
  "unauthorized",
  "forbidden",
  "validation",
  "conflict",
  "not_implemented",
  "upstream",
  "internal",
] as const;

export type ErrorKind = (typeof errorKinds)[number];

export interface JarvisError {
  readonly kind: ErrorKind;
  readonly message: string;
  /** Machine-readable context. Must never contain secrets or raw credentials. */
  readonly details?: Readonly<Record<string, unknown>>;
}

export function jarvisError(
  kind: ErrorKind,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): JarvisError {
  return details ? { kind, message, details } : { kind, message };
}

export const notFound = (what: string, id?: string): JarvisError =>
  jarvisError("not_found", `${what} not found`, id ? { id } : undefined);

export const notImplemented = (what: string): JarvisError =>
  jarvisError("not_implemented", `${what} is not implemented yet`);
