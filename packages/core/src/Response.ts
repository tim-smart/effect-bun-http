import { ToResponseOptions } from "./internal/HttpFs.js"
import { toReadableStream } from "./util/stream.js"

/**
 * @tsplus type effect-http/Response
 * @tsplus companion effect-http/Response.Ops
 */
export type HttpResponse =
  | EmptyResponse
  | TextResponse
  | FormDataResponse
  | StreamResponse
  | RawResponse

export class HttpStreamError {
  readonly _tag = "HttpStreamError"
  constructor(readonly error: unknown) {}
}

export class EmptyResponse {
  readonly _tag = "EmptyResponse"
  constructor(readonly status: number, readonly headers: Maybe<Headers>) {}
}

export class TextResponse {
  readonly _tag = "TextResponse"
  constructor(
    readonly status: number,
    readonly headers: Maybe<Headers>,
    readonly contentType: string,
    readonly body: string,
  ) {}
}

export class FormDataResponse {
  readonly _tag = "FormDataResponse"
  constructor(
    readonly status: number,
    readonly headers: Maybe<Headers>,
    readonly body: FormData,
  ) {}
}

export class StreamResponse {
  readonly _tag = "StreamResponse"
  constructor(
    readonly status: number,
    readonly headers: Maybe<Headers>,
    readonly contentType: string,
    readonly contentLength: Maybe<number>,
    readonly body: Stream<never, HttpStreamError, Uint8Array>,
  ) {}
}

export class RawResponse {
  readonly _tag = "RawResponse"
  constructor(
    readonly status: number,
    readonly headers: Maybe<Headers>,
    readonly body: unknown,
  ) {}
}

/**
 * @tsplus static effect-http/Response.Ops empty
 */
export const empty = ({
  headers = Maybe.none,
  status = 204,
}: {
  status?: number
  headers?: Maybe<Headers>
} = {}): HttpResponse => new EmptyResponse(status, headers)

/**
 * @tsplus static effect-http/Response.Ops json
 */
export const json = (
  value: unknown,
  {
    headers = Maybe.none,
    status = 200,
  }: {
    status?: number
    headers?: Maybe<Headers>
  } = {},
): HttpResponse =>
  new TextResponse(status, headers, "application/json", JSON.stringify(value))

/**
 * @tsplus static effect-http/Response.Ops text
 */
export const text = (
  value: string,
  {
    headers = Maybe.none,
    status = 200,
    contentType = "text/plain",
  }: {
    status?: number
    contentType?: string
    headers?: Maybe<Headers>
  } = {},
): HttpResponse => new TextResponse(status, headers, contentType, value)

/**
 * @tsplus static effect-http/Response.Ops html
 */
export const html = (
  value: string,
  {
    headers = Maybe.none,
    status = 200,
  }: {
    status?: number
    contentType?: string
    headers?: Maybe<Headers>
  } = {},
): HttpResponse => new TextResponse(status, headers, "text/html", value)

/**
 * @tsplus static effect-http/Response.Ops searchParams
 */
export const searchParams = (
  value: URLSearchParams,
  {
    headers = Maybe.none,
    status = 200,
  }: {
    status?: number
    headers?: Maybe<Headers>
  } = {},
): HttpResponse =>
  new TextResponse(
    status,
    headers,
    "application/x-www-form-urlencoded",
    value.toString(),
  )

/**
 * @tsplus static effect-http/Response.Ops stream
 */
export const stream = (
  value: Stream<never, HttpStreamError, Uint8Array>,
  {
    headers,
    status = 200,
    contentType = "application/octet-stream",
    contentLength,
  }: {
    status?: number
    headers?: Headers
    contentType?: string
    contentLength?: number
  } = {},
): HttpResponse =>
  new StreamResponse(
    status,
    Maybe.fromNullable(headers),
    contentType,
    Maybe.fromNullable(contentLength),
    value,
  )

/**
 * @tsplus static effect-http/Response.Ops formData
 */
export const formData = (
  value: FormData,
  {
    headers,
    status = 200,
  }: {
    status?: number
    headers?: Headers
  } = {},
): HttpResponse =>
  new FormDataResponse(status, Maybe.fromNullable(headers), value)

/**
 * @tsplus static effect-http/Response.Ops raw
 */
export const raw = (
  body: unknown,
  {
    headers,
    status = 200,
  }: {
    status?: number
    headers?: Headers
  } = {},
): HttpResponse => new RawResponse(status, Maybe.fromNullable(headers), body)

/**
 * @tsplus static effect-http/Response.Ops file
 */
export const file = (path: string, opts: ToResponseOptions = {}) =>
  HttpFs.accessWithEffect((_) => _.toResponse(path, opts))

export class EarlyResponse {
  readonly _tag = "EarlyResponse"
  constructor(readonly response: HttpResponse) {}
}

/**
 * @tsplus getter effect-http/Response.Ops early
 */
export const early = (
  response: HttpResponse,
): Effect<never, EarlyResponse, never> =>
  Effect.fail(new EarlyResponse(response))

/**
 * @tsplus fluent effect-http/Response toStandard
 * @tsplus static effect-http/Response.Ops toStandard
 */
export const toStandard = (self: HttpResponse): Response => {
  if (self._tag === "EmptyResponse") {
    return new Response(null, {
      status: self.status,
      headers: self.headers._tag === "Some" ? self.headers.value : undefined,
    })
  }

  const headers =
    self.headers._tag === "Some" ? self.headers.value : new Headers()
  let body: any = null

  switch (self._tag) {
    case "TextResponse":
      headers.set("content-type", self.contentType)
      body = self.body
      break

    case "RawResponse":
    case "FormDataResponse":
      body = self.body
      break

    case "StreamResponse":
      headers.set("content-type", self.contentType)
      if (self.contentLength._tag === "Some") {
        headers.set("content-length", self.contentLength.toString())
      }
      body = toReadableStream(self.body)
      break

    case "RawResponse":
  }

  return new Response(body, {
    status: self.status,
    headers,
  })
}
