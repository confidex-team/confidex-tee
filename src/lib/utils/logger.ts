interface LogRequest {
  method: string;
  url: string;
  query?: Record<string, string>;
  params?: Record<string, string>;
  body?: unknown;
}

interface LogResponse {
  status?: number;
  statusText?: string;
  data?: unknown;
}

interface LogError {
  message: string;
  status?: number;
  stack?: string;
}

interface LogMetadata {
  duration?: string;
  [key: string]: unknown;
}

export class Logger {
  static logRequest(request: LogRequest, response: LogResponse, metadata?: LogMetadata) {
    console.log({
      request,
      response,
      ...metadata,
    });
  }

  static logErrorWithRequest(request: LogRequest, error: LogError, metadata?: LogMetadata) {
    console.error({
      request,
      error,
      ...metadata,
    });
  }

  static logInfo(message: string, data?: unknown) {
    console.log({
      message,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  static logDebug(message: string, data?: unknown) {
    console.debug({
      message,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  static logWarn(message: string, data?: unknown) {
    console.warn({
      message,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  static logError(message: string, error: Error | unknown) {
    console.error({
      message,
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
      } : error,
      timestamp: new Date().toISOString(),
    });
  }
} 