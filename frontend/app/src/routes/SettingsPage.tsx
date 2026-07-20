import { AlertTriangle, CheckCircle2, RefreshCw, Server } from "lucide-react";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeader } from "@/components/ui/Card";
import { backendUrl, normalizeAPIError } from "@/api/client";
import { createInvite } from "@/api/users";
import { useCurrentUser, useHealthStatus } from "@/api/hooks";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { useI18n } from "@/i18n/I18nProvider";
import { type ThemeMode, useTheme } from "@/theme/ThemeProvider";

const themes: ThemeMode[] = ["light", "dark", "system"];

export function SettingsPage() {
  const { locale, setLocale, t } = useI18n();
  const { theme, setTheme } = useTheme();
  const healthQuery = useHealthStatus({ refetchInterval: 30_000 });
  const currentUser = useCurrentUser();
  const isHealthy = healthQuery.data?.status === "healthy";
  const healthLabel = healthQuery.isLoading
    ? t("checking")
    : isHealthy
      ? t("online")
      : t("offline");

  return (
    <div className="grid gap-5">
      <SectionHeader title={t("settings")} description={t("settingsDescription")} />
      <Card className="grid gap-4">
        <div>
          <h2 className="text-base font-semibold">{t("language")}</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              variant={locale === "zh-CN" ? "primary" : "secondary"}
              onClick={() => setLocale("zh-CN")}
            >
              中文
            </Button>
            <Button
              type="button"
              variant={locale === "en-US" ? "primary" : "secondary"}
              onClick={() => setLocale("en-US")}
            >
              English
            </Button>
          </div>
        </div>
        <div>
          <h2 className="text-base font-semibold">{t("theme")}</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {themes.map((item) => (
              <Button
                key={item}
                type="button"
                variant={theme === item ? "primary" : "secondary"}
                onClick={() => setTheme(item)}
              >
                {t(item)}
              </Button>
            ))}
          </div>
        </div>
      </Card>
      {currentUser.data?.role === "admin" ? <AdminInviteCard /> : null}
      <Card className="grid gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
              <Server aria-hidden="true" size={20} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold">{t("systemConnection")}</h2>
              <p className="mt-1 break-all text-sm text-muted-foreground">{backendUrl}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void healthQuery.refetch()}
            disabled={healthQuery.isFetching}
          >
            <RefreshCw
              aria-hidden="true"
              className={healthQuery.isFetching ? "animate-spin" : undefined}
              size={16}
            />
            {t("refresh")}
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <StatusMetric
            label={t("connectionStatus")}
            value={healthLabel}
            tone={isHealthy ? "success" : healthQuery.isLoading ? "neutral" : "danger"}
          />
          <StatusMetric label={t("engine")} value={healthQuery.data?.engine ?? "-"} />
          <StatusMetric
            label={t("memory")}
            value={
              typeof healthQuery.data?.memory_usage_mb === "number"
                ? `${healthQuery.data.memory_usage_mb.toFixed(2)} MB`
                : "-"
            }
          />
          <StatusMetric
            label={t("cpu")}
            value={
              typeof healthQuery.data?.cpu_percent === "number"
                ? `${healthQuery.data.cpu_percent.toFixed(1)}%`
                : "-"
            }
          />
        </div>

        {healthQuery.isError ? (
          <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
            <p className="min-w-0 break-words">
              {t("backendOfflineHint")}: {formatError(healthQuery.error)}
            </p>
          </div>
        ) : null}

        {isHealthy ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 aria-hidden="true" className="text-accent" size={16} />
            <span>{t("backendOnlineHint")}</span>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function AdminInviteCard() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"teacher" | "student">("teacher");
  const invite = useMutation({ mutationFn: createInvite });

  return (
    <Card className="grid gap-4">
      <div>
        <h2 className="text-base font-semibold">生成邀请码</h2>
        <p className="mt-1 text-sm text-muted-foreground">邀请码默认 7 天有效且只能使用一次。</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="绑定邮箱（可选）"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="账号角色">
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={role} onChange={(e) => setRole(e.target.value as "teacher" | "student")}>
            <option value="teacher">教师</option><option value="student">学生</option>
          </select>
        </Field>
        <div className="flex items-end"><Button type="button" disabled={invite.isPending} onClick={() => invite.mutate({ email: email.trim(), role, expires_in_hours: 168 })}>{invite.isPending ? "生成中…" : "生成"}</Button></div>
      </div>
      {invite.data ? <div className="rounded-md border bg-muted p-3 text-sm"><div className="font-mono text-lg font-semibold">{invite.data.invite_code}</div><div className="mt-1 text-muted-foreground">有效期至 {new Date(invite.data.expires_at * 1000).toLocaleString()}</div></div> : null}
      {invite.isError ? <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{normalizeAPIError(invite.error).message}</div> : null}
    </Card>
  );
}

function StatusMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "text-accent"
      : tone === "danger"
        ? "text-danger"
        : "text-foreground";

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`mt-1 break-words text-sm font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unknown error";
}
