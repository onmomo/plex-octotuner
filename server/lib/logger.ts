type LogContext = Record<string, unknown> | unknown[] | string | number | boolean | null | undefined
type LogMethod = (message?: unknown, ...optionalParams: unknown[]) => void
type LogWriter = {
  info: LogMethod
  warn: LogMethod
  error: LogMethod
}

export type Logger = {
  sink: string[]
  info(message: string, context?: LogContext): void
  error(message: string, context?: LogContext): void
  warn(message: string, context?: LogContext): void
}

const URL_IN_TEXT_PATTERN = /https?:\/\/[^\s"'<>]+/gi
const DEFAULT_SINK_LIMIT = 200

function sanitizeUrlText(value: string): string {
  return value.replace(URL_IN_TEXT_PATTERN, (candidate) => {
    try {
      const url = new URL(candidate)
      url.username = ''
      url.password = ''
      url.search = ''
      url.hash = ''
      return url.toString()
    } catch {
      return candidate.split(/[?#]/)[0]
    }
  })
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeUrlText(value)
  }

  if (value instanceof Error) {
    const extra = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeValue(entry)])
    )

    return {
      name: value.name,
      message: sanitizeUrlText(value.message),
      stack: value.stack ? sanitizeUrlText(value.stack) : undefined,
      cause: sanitizeValue(value.cause),
      ...extra
    }
  }

  if (value instanceof URL) {
    const url = new URL(value.toString())
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeValue(entry)])
    )
  }

  return value
}

function formatLogLine(message: string, context?: LogContext): string {
  if (context === undefined) {
    return sanitizeUrlText(message)
  }

  return `${sanitizeUrlText(message)} ${JSON.stringify(sanitizeValue(context))}`
}

function appendToSink(sink: string[], line: string, sinkLimit: number): void {
  sink.push(line)

  if (sink.length > sinkLimit) {
    sink.splice(0, sink.length - sinkLimit)
  }
}

export function createLogger(writer: LogWriter = console, sinkLimit = DEFAULT_SINK_LIMIT): Logger {
  const sink: string[] = []

  const emit = (method: keyof LogWriter, message: string, context?: LogContext): void => {
    const line = formatLogLine(message, context)
    appendToSink(sink, line, sinkLimit)
    writer[method](line)
  }

  return {
    sink,
    info(message, context) {
      emit('info', message, context)
    },
    error(message, context) {
      emit('error', message, context)
    },
    warn(message, context) {
      emit('warn', message, context)
    }
  }
}
