import type { FormEvent } from "react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useRegister } from "@/api/hooks";
import { normalizeAPIError } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

export function RegisterPage() {
  const navigate = useNavigate();
  const register = useRegister();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"teacher" | "student">("teacher");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const normalizedInviteCode = inviteCode.trim();
      await register.mutateAsync({
        username: username.trim(),
        email: email.trim(),
        password,
        role,
        ...(normalizedInviteCode ? { invite_code: normalizedInviteCode } : {}),
      });
      navigate("/", { replace: true });
    } catch (reason) {
      setError(normalizeAPIError(reason).message);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md p-6">
        <h1 className="text-center text-2xl font-semibold">创建账号</h1>
        <p className="mt-2 text-center text-sm leading-6 text-muted-foreground">本地开发可直接注册；服务器关闭公开注册时，请填写管理员提供的邀请码。管理员账号由服务器管理员创建。</p>
        <form className="mt-6 grid gap-4" onSubmit={submit}>
          <Field label="用户名"><Input autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
          <Field label="邮箱（可选）"><Input autoComplete="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="密码"><Input autoComplete="new-password" minLength={6} required type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Field label="角色">
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={role}
              onChange={(event) => setRole(event.target.value as "teacher" | "student")}
            >
              <option value="teacher">教师</option>
              <option value="student">学生</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">使用邀请码注册时，以邀请码绑定的角色为准。</p>
          </Field>
          <Field label="邀请码（服务器需要时填写）"><Input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} /></Field>
          {error ? <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div> : null}
          <Button type="submit" className="w-full" disabled={register.isPending}>{register.isPending ? "注册中…" : "注册"}</Button>
        </form>
        <div className="mt-5 text-center text-sm text-muted-foreground">已有账号？ <Link className="font-medium text-primary" to="/login">返回登录</Link></div>
      </Card>
    </main>
  );
}
