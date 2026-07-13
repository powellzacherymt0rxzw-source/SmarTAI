import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { clearAuthToken, getAuthToken } from "@/api/client";
import { useCurrentUser } from "@/api/hooks";
import { Card } from "@/components/ui/Card";

export function RequireTeacherSession({ children }: { children: ReactNode }) {
  const hasToken = Boolean(getAuthToken());
  const currentUser = useCurrentUser();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}${location.hash}`;

  if (!hasToken) {
    return <Navigate to="/login" replace state={{ from: returnTo }} />;
  }

  if (currentUser.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-sm text-center text-sm text-muted-foreground">
          正在恢复登录状态...
        </Card>
      </main>
    );
  }

  if (currentUser.isError || !currentUser.data) {
    return (
      <ResetSessionAndRedirect message="登录状态已过期，请重新登录。" returnTo={returnTo} />
    );
  }

  if (currentUser.data.role !== "teacher" && currentUser.data.role !== "admin") {
    return (
      <ResetSessionAndRedirect
        message="当前 React 前端仅开放教师端流程，请使用教师账号登录。"
        returnTo={returnTo}
      />
    );
  }

  return children;
}

function ResetSessionAndRedirect({ message, returnTo }: { message: string; returnTo: string }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    clearAuthToken();
    queryClient.clear();
  }, [queryClient]);

  return <Navigate to="/login" replace state={{ authError: message, from: returnTo }} />;
}
