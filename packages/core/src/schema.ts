import { Json, To } from "@effect/schema/Schema"
import type { HttpRequest } from "./Request.js"

export type JsonSchema = Schema<Json, any>
export type ParamsSchema = Schema<Record<string, string | undefined>, any>

export class DecodeSchemaError {
  readonly _tag = "DecodeSchemaError"
  constructor(
    readonly errors: NonEmptyReadonlyArray<ParseError>,
    readonly request: HttpRequest,
    readonly body: unknown,
  ) {}
}

const decodeEither =
  <ParentSchema extends Schema<any>>() =>
  <S extends ParentSchema>(schema: S) => {
    const decode = schema.decodeEither

    return (
      input: unknown,
      request: HttpRequest,
    ): Either<DecodeSchemaError, To<S>> =>
      decode(input).mapLeft(_ => new DecodeSchemaError(_, request, input))
  }

const decodeEffect =
  <ParentSchema extends Schema<any>>() =>
  <S extends ParentSchema>(schema: S) => {
    const decode = decodeEither()(schema)
    return (input: unknown, request: HttpRequest) =>
      Effect.fromEither(decode(input, request))
  }

export const decode = <S extends JsonSchema>(schema: S) => {
  const decode = decodeEffect<JsonSchema>()(schema)

  return Do($ => {
    const ctx = $(Effect.service(RouteContext))
    const params = $(parseBodyWithParams(ctx))

    return $(decode(params, ctx.request))
  })
}

export const decodeParams = <S extends ParamsSchema>(schema: S) => {
  const decode = decodeEffect<ParamsSchema>()(schema)

  return Do($ => {
    const { request, params, searchParams } = $(Effect.service(RouteContext))
    return $(decode({ ...params, ...searchParams }, request))
  })
}

export class FormDataKeyNotFound {
  readonly _tag = "FormDataKeyNotFound"
  constructor(readonly key: string) {}
}

const jsonParse = Either.liftThrowable(
  (_: string) => JSON.parse(_) as unknown,
  _ => new RequestBodyError(_),
)

export const decodeJsonFromFormData =
  <S extends JsonSchema>(schema: S) =>
  (key: string, formData?: FormData) => {
    const decode = decodeEither<JsonSchema>()(schema)

    return Do($ => {
      const { request } = $(Effect.service(RouteContext))
      const data = $(formData ? Effect.succeed(formData) : request.formData)

      const result = Either.fromNullable(
        data.get(key),
        () => new RequestBodyError(new FormDataKeyNotFound(key)),
      )
        .flatMap(_ => jsonParse(_.toString()))
        .flatMap(_ => decode(_, request))
        .map(value => [value, data] as const)

      return $(Effect.fromEither(result))
    })
  }

export const parseBodyWithParams = ({
  request,
  params,
  searchParams,
}: RouteContext) =>
  Do(($): unknown => {
    const allParams = { ...searchParams, ...params }
    const body = $(parseBody(request))

    return body._tag === "Some"
      ? {
          ...allParams,
          ...(body.value as any),
        }
      : allParams
  })

export const parseBody = (request: HttpRequest) => {
  const contentType = request.headers.get("content-type")?.toLowerCase()

  if (contentType?.includes("application/json")) {
    return request.json.asSome
  } else if (contentType?.includes("application/x-www-form-urlencoded")) {
    return queryStringBody(request).asSome
  }

  return Effect.succeed(Maybe.none())
}

export const queryStringBody = (request: HttpRequest) =>
  request.text.flatMap(a =>
    Effect.tryCatch(
      () => Object.fromEntries(new URLSearchParams(a).entries()),
      reason => new RequestBodyError(reason),
    ),
  )
