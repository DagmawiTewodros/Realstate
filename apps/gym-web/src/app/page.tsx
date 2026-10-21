"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loading } from "@platform/ui";
import { api } from "@/lib/api";
import { homeFor, type SessionUser } from "@/lib/session";

/** The gym app has no public pages: signed-in people go to their home, everyone else to sign in. */
export default function Home() {
  const router = useRouter();
  const c = useTranslations("common");
  useEffect(() => {
    api<{ user: SessionUser }>("/auth/me")
      .then((r) => router.replace(homeFor(r.user.role)))
      .catch(() => router.replace("/login"));
  }, [router]);
  return (
    <main>
      <div className="container">
        <Loading label={c("loading")} />
      </div>
    </main>
  );
}
