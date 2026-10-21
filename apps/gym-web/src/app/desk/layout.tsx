"use client";

import type { ReactNode } from "react";
import { SessionProvider } from "@/lib/session";
import { DeskShell } from "@/components/DeskShell";

export default function DeskLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider require={["OWNER", "GYM_MANAGER", "FRONT_DESK", "TRAINER"]}>
      <DeskShell>{children}</DeskShell>
    </SessionProvider>
  );
}
