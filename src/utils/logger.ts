export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export function createLogger(scope = "pipeline"): Logger {
  const format = (level: string, message: string): string =>
    `[${new Date().toISOString()}] [${scope}] [${level}] ${message}`;

  return {
    info(message: string): void {
      console.log(format("info", message));
    },
    warn(message: string): void {
      console.warn(format("warn", message));
    },
    error(message: string): void {
      console.error(format("error", message));
    }
  };
}
