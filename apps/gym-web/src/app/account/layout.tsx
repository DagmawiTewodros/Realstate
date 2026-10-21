"use client";

import type { ReactNode } from "react";
import { SessionProvider, useSession } from "@/lib/session";
import { DeskShell, MemberShell } from "@/components/DeskShell";

function Shell({ children }: { children: ReactNode }) {
  const { user } = useSession();
  return user?.role === "MEMBER" ? <MemberShell>{children}</MemberShell> : <DeskShell>{children}</DeskShell>;
}

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
