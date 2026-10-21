"use client";

import { useState } from "react";
import { Alert, Button } from "@platform/ui";
import { api } from "@/lib/api";

/** One-button page for signed links (opt-out, remove a saved search). Works only by POST, never on open. */
export function TokenAction({ endpoint, button, done, invalid }: { endpoint: string; button: string; done: string; invalid: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "invalid">("idle");
  async function run() {
    setState("busy");
    try {
      await api(endpoint, { method: "POST" });
      setState("done");
    } catch {
      setState("invalid");
    }
  }
  if (state === "done") return <Alert kind="ok">{done}</Alert>;
  if (state === "invalid") return <Alert kind="error">{invalid}</Alert>;
  return (
    <Button onClick={() => void run()} disabled={state === "busy"}>
      {button}
    </Button>
  );
}
