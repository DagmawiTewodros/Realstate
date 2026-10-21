"use client";

import type { ReactNode } from "react";
import { SessionProvider } from "@/lib/session";
import { StaffShell } from "@/components/StaffShell";

export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider require={["OWNER", "SALES_MANAGER", "BROKER", "PROPERTY_MANAGER"]}>
      <StaffShell>{children}</StaffShell>
    </SessionProvider>
  );
}
