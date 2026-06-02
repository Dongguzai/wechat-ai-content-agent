import { BooleanBadge } from "@/components/status-badge";
import { getSettingsStatus } from "@/lib/dashboard-data";

export default async function SettingsPage() {
  const settings = await getSettingsStatus();

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-6 shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Settings</p>
        <h2 className="mt-2 text-2xl font-bold text-ink">脱敏环境状态</h2>
        <p className="mt-3 text-sm text-stone-600">这里只显示布尔状态，不显示 .env 原文、AppSecret、access_token 或 API key。</p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Setting label="REAL_PRODUCTION_MODE 是否 true" value={settings.realProductionModeIsTrue} />
        <Setting label="LLM_PROVIDER 是否 minimax" value={settings.llmProviderIsMinimax} />
        <Setting label="COVER_IMAGE_PROVIDER 是否 apimart" value={settings.coverImageProviderIsApimart} />
        <Setting label="WECHAT_API_ENABLE_REAL_DRAFT 是否 true" value={settings.wechatApiEnableRealDraftIsTrue} />
        <Setting label="存在 MINIMAX_API_KEY" value={settings.secretsPresent.MINIMAX_API_KEY} />
        <Setting label="存在 APIMART_API_KEY" value={settings.secretsPresent.APIMART_API_KEY} />
        <Setting label="存在 WECHAT_APP_SECRET" value={settings.secretsPresent.WECHAT_APP_SECRET} />
      </section>
    </div>
  );
}

function Setting({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="mb-3 text-sm font-bold text-ink">{label}</div>
      <BooleanBadge value={value} />
    </div>
  );
}
