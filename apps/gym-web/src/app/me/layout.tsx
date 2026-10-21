"use client";

import type { ReactNode } from "react";
import { SessionProvider } from "@/lib/session";
import { MemberShell } from "@/components/DeskShell";

export default function MemberLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider require={["MEMBER"]}>
      <MemberShell>{children}</MemberShell>
    </SessionProvider>
  );
}
