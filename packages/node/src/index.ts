import type { Effect } from "@effect/io/Effect"
import type { HttpApp } from "@effect-http/core"
import { HttpRequest, RequestBodyError } from "@effect-http/core/Request"
import type { ListenOptions } from "net"
import { EarlyResponse, HttpResponse } from "@effect-http/core/Response"
import * as Http from "http"
import * as Body from "./body.js"
import { Readable } from "stream"

export interface RequestOptions {
  bodyLimit: number
}

const KB = 1024
const MB = 1024 * KB

/**
 * @tsplus pipeable effect-http/HttpApp serveNode
 */
export const make =
  (
    server: Http.Server,
    options: ListenOptions & { port: number } & Partial<RequestOptions>,
  ) =>
  <R>(httpApp: HttpApp<R, EarlyResponse>): Effect<R, never, never> =>
    Effect.runtime<R>().flatMap((rt) =>
      Effect.asyncInterrupt<never, never, never>(() => {
        const reqOptions: RequestOptions = {
          bodyLimit: options.bodyLimit ?? 5 * MB,
        }

        server.on("request", (request, response) => {
          const url = requestUrl(request, options.port)

          rt.unsafeRun(
            httpApp(new HttpRequestImpl(request, url, url, reqOptions)).tap(
              (r) =>
                Effect(() => {
                  handleResponse(r, response)
                }),
            ),
          )
        })

        server.listen(options)

        return Effect.async((resume) => {
          server.close(() => resume(Effect.unit()))
        })
      }),
    )

class HttpRequestImpl implements HttpRequest {
  constructor(
    readonly source: Http.IncomingMessage,
    readonly url: string,
    readonly originalUrl: string,
    readonly options: RequestOptions,
  ) {}

  get method() {
    return this.source.method!
  }

  get headers() {
    return new Headers(this.source.headers as Record<string, string>)
  }

  setUrl(url: string): HttpRequest {
    return new HttpRequestImpl(this.source, url, this.originalUrl, this.options)
  }

  get text() {
    return Body.utf8String(this.source, this.options.bodyLimit).mapError(
      (e) => new RequestBodyError(e),
    )
  }

  get json() {
    return this.text.flatMap((body) =>
      Effect.tryCatch(
        () => JSON.parse(body) as unknown,
        (reason) => new RequestBodyError(reason),
      ),
    )
  }

  get stream() {
    return Effect.succeed(Readable.toWeb(this.source) as any)
  }
}

const handleResponse = (source: HttpResponse, dest: Http.ServerResponse) => {
  const headers: Record<string, string> =
    source.headers._tag === "Some"
      ? Object.fromEntries(source.headers.value.entries())
      : {}
  let body: string | null = null

  switch (source._tag) {
    case "JsonResponse":
      headers["content-type"] = "application/json"
      body = JSON.stringify(source.body)
      headers["content-length"] = Buffer.byteLength(body).toString()
      break

    case "TextResponse":
      headers["content-type"] = source.contentType
      body = source.body
      headers["content-length"] = Buffer.byteLength(body).toString()
      break

    case "SearchParamsResponse":
      headers["content-type"] = "application/x-www-form-urlencoded"
      body = source.body.toString()
      headers["content-length"] = Buffer.byteLength(body).toString()
      break

    case "StreamResponse":
      headers["content-type"] = source.contentType
      if (source.contentLength._tag === "Some") {
        headers["content-length"] = source.contentLength.value.toString()
      }
      dest.writeHead(source.status, headers)
      Readable.fromWeb(source.body as any).pipe(dest)
      return
  }

  dest.writeHead(source.status, headers)
  dest.end(body)
}

const requestUrl = (source: Http.IncomingMessage, port: number) => {
  const proto = requestProtocol(source)
  const host = requestHost(source, port)

  return `${proto}://${host}${source.url}`
}

const requestProtocol = (source: Http.IncomingMessage) => {
  if ((source.socket as any).encrypted) {
    return "https"
  } else if (typeof source.headers["x-forwarded-proto"] === "string") {
    return source.headers["x-forwarded-proto"].trim()
  }

  return "http"
}

const requestHost = (source: Http.IncomingMessage, port: number) => {
  if (typeof source.headers["x-forwarded-host"] === "string") {
    return source.headers["x-forwarded-host"].trim()
  } else if (typeof source.headers["host"] === "string") {
    return source.headers["host"].trim()
  }

  return `localhost:${port}`
}
