export type NotificationStatus = "success" | "failed";

export type NotificationMethod = "console" | "webhook";

export type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export interface NotificationPayload {
  status: NotificationStatus;
  title: string;
  message: string;
  selectedTitle: string | null;
  draftMediaId: string | null;
  reportPath: string;
  requiresHumanConfirmation: true;
  generatedAt: string;
}

export interface NotificationConfig {
  enabled: boolean;
  method: NotificationMethod;
  webhookUrl: string;
  emailTo: string;
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
}

export interface SendNotificationOptions {
  config: NotificationConfig;
  payload: NotificationPayload;
  fetchImpl?: FetchLike;
  consoleNotify?: (message: string) => void;
}

export interface SendNotificationResult {
  attempted: boolean;
  sent: boolean;
  method: NotificationMethod | "disabled";
  warning: string | null;
}

function envValue(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.trim() ?? "";
}

function parseBoolean(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: boolean
): boolean {
  const value = envValue(env, name).toLowerCase();

  if (!value) {
    return defaultValue;
  }

  return value === "true";
}

function parseMethod(value: string): NotificationMethod {
  return value === "webhook" ? "webhook" : "console";
}

export function createNotificationConfig(
  env: NodeJS.ProcessEnv
): NotificationConfig {
  return {
    enabled: parseBoolean(env, "NOTIFY_ENABLE", false),
    method: parseMethod(envValue(env, "NOTIFY_METHOD").toLowerCase()),
    webhookUrl: envValue(env, "NOTIFY_WEBHOOK_URL"),
    emailTo: envValue(env, "NOTIFY_EMAIL_TO"),
    notifyOnSuccess: parseBoolean(env, "NOTIFY_ON_SUCCESS", false),
    notifyOnFailure: parseBoolean(env, "NOTIFY_ON_FAILURE", true)
  };
}

export function shouldSendNotification(input: {
  config: NotificationConfig;
  status: NotificationStatus;
}): boolean {
  if (!input.config.enabled) {
    return false;
  }

  return input.status === "success"
    ? input.config.notifyOnSuccess
    : input.config.notifyOnFailure;
}

function safeText(value: string): string {
  return value
    .replace(/access_token/gi, "credential")
    .replace(/appsecret/gi, "credential")
    .replace(/app_secret/gi, "credential")
    .replace(/apimart_api_key/gi, "credential")
    .replace(/wechat_app_secret/gi, "credential");
}

export function sanitizeNotificationPayload(
  payload: NotificationPayload
): NotificationPayload {
  return {
    ...payload,
    title: safeText(payload.title),
    message: safeText(payload.message),
    selectedTitle: payload.selectedTitle ? safeText(payload.selectedTitle) : null,
    draftMediaId: payload.draftMediaId ? safeText(payload.draftMediaId) : null,
    reportPath: safeText(payload.reportPath)
  };
}

export async function sendNotification(
  options: SendNotificationOptions
): Promise<SendNotificationResult> {
  const { config } = options;

  if (!shouldSendNotification({ config, status: options.payload.status })) {
    return {
      attempted: false,
      sent: false,
      method: "disabled",
      warning: null
    };
  }

  const payload = sanitizeNotificationPayload(options.payload);

  if (config.method === "console") {
    options.consoleNotify?.(`[daily-auto] notification ${JSON.stringify(payload)}`);
    return {
      attempted: true,
      sent: true,
      method: "console",
      warning: null
    };
  }

  if (!config.webhookUrl) {
    return {
      attempted: true,
      sent: false,
      method: "webhook",
      warning: "NOTIFY_METHOD=webhook requires NOTIFY_WEBHOOK_URL."
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(config.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return {
        attempted: true,
        sent: false,
        method: "webhook",
        warning: `Notification webhook returned HTTP ${response.status}.`
      };
    }

    return {
      attempted: true,
      sent: true,
      method: "webhook",
      warning: null
    };
  } catch (error) {
    return {
      attempted: true,
      sent: false,
      method: "webhook",
      warning:
        error instanceof Error
          ? `Notification webhook failed: ${error.message}`
          : "Notification webhook failed."
    };
  }
}
