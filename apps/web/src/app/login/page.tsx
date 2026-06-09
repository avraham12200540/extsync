"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/components/providers";
import { Button, Card, Field, Input } from "@/components/ui";
import { ApiError } from "@/lib/api";

const schema = z.object({
  email: z.string().email("אימייל לא תקין"),
  password: z.string().min(1, "נדרשת סיסמה"),
});
type Form = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const { login, complete2fa } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: Form) => {
    setServerError(null);
    try {
      const res = await login(data.email, data.password);
      if (res.twoFactorRequired && res.challenge) setChallenge(res.challenge);
      else router.push("/app");
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : "ההתחברות נכשלה");
    }
  };

  const submit2fa = async () => {
    if (!challenge) return;
    setServerError(null);
    try {
      await complete2fa(challenge, code);
      router.push("/app");
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : "קוד שגוי");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-md">
        <h1 className="mb-6 text-2xl font-semibold text-ink">התחברות ל-ExtSync</h1>
        {serverError && <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-danger">{serverError}</p>}

        {!challenge ? (
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <Field label="אימייל" error={errors.email?.message}>
              <Input type="email" autoComplete="email" {...register("email")} />
            </Field>
            <Field label="סיסמה" error={errors.password?.message}>
              <Input type="password" autoComplete="current-password" {...register("password")} />
            </Field>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "מתחבר…" : "התחברות"}
            </Button>
          </form>
        ) : (
          <div>
            <p className="mb-3 text-sm text-ink-muted">הזן את הקוד מאפליקציית האימות (או קוד שחזור):</p>
            <Field label="קוד אימות">
              <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoFocus />
            </Field>
            <Button className="w-full" onClick={submit2fa}>אישור</Button>
          </div>
        )}

        <div className="mt-4 flex justify-between text-sm">
          <Link href="/forgot-password" className="text-brand hover:underline">שכחתי סיסמה</Link>
          <Link href="/register" className="text-brand hover:underline">פתיחת חשבון</Link>
        </div>
      </Card>
    </div>
  );
}
