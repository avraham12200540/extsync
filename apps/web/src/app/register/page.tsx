"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { Button, Card, Field, Input } from "@/components/ui";

const schema = z.object({
  displayName: z.string().min(1, "נדרש שם תצוגה"),
  orgName: z.string().optional().default(""),
  email: z.string().email("אימייל לא תקין"),
  password: z.string().min(10, "לפחות 10 תווים"),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "יש לאשר את תנאי השימוש" }) }),
});
type Form = z.infer<typeof schema>;

export default function RegisterPage() {
  const [done, setDone] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: Form) => {
    setServerError(null);
    try {
      await api.post("/auth/register", data);
      setDone(true);
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : "ההרשמה נכשלה");
    }
  };

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <Card className="w-full max-w-md text-center">
          <h1 className="mb-2 text-2xl font-semibold text-ink">כמעט סיימנו 🎉</h1>
          <p className="text-ink-muted">
            שלחנו אליך אימייל לאימות הכתובת. פתח את הקישור שבמייל כדי להפעיל את החשבון.
          </p>
          <Link href="/login" className="mt-4 inline-block text-brand hover:underline">חזרה להתחברות</Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-10">
      <Card className="w-full max-w-md">
        <h1 className="mb-6 text-2xl font-semibold text-ink">פתיחת חשבון מפתח</h1>
        {serverError && <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-danger">{serverError}</p>}
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <Field label="שם תצוגה" error={errors.displayName?.message}>
            <Input {...register("displayName")} />
          </Field>
          <Field label="שם מפתח / ארגון" error={errors.orgName?.message}>
            <Input {...register("orgName")} />
          </Field>
          <Field label="אימייל" error={errors.email?.message}>
            <Input type="email" autoComplete="email" {...register("email")} />
          </Field>
          <Field label="סיסמה" error={errors.password?.message}>
            <Input type="password" autoComplete="new-password" {...register("password")} />
          </Field>
          <label className="mb-4 flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" {...register("acceptTerms")} />
            אני מאשר/ת את תנאי השימוש ומדיניות הפרטיות
          </label>
          {errors.acceptTerms && <p className="mb-3 text-xs text-danger">{errors.acceptTerms.message}</p>}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "נרשם…" : "הרשמה"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-ink-muted">
          כבר יש חשבון? <Link href="/login" className="text-brand hover:underline">התחברות</Link>
        </p>
      </Card>
    </div>
  );
}
