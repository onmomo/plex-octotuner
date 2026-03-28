type LogContext = Record<string, unknown> | unknown[] | string | number | boolean | null | undefined

export type Logger = {
  sink: string[]
  info(message: string, context?: LogContext): void
}

const URL_IN_TEXT_PATTERN = /https?:\/\/[^\s"'<>]+/gi

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

export function createLogger(): Logger {
  const sink: string[] = []

  return {
    sink,
    info(message, context) {
      sink.push(formatLogLine(message, context))
    }
  }
}
