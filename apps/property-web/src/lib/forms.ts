"use client";

import { useCallback, useState } from "react";
import { parseBirrToMinor } from "@platform/shared";
import { ApiError } from "./api";

/**
 * Runs a save or other action with busy, error, and field-error state.
 * Returns the action's result, or undefined when it failed (the error is shown by the caller).
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFieldErrors(e.fieldErrors());
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, fieldErrors, run, setError };
}

/** Reads a text field from a form; empty strings become null. */
export function text(form: FormData, name: string): string | null {
  const v = form.get(name);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

/** Reads an integer field; empty becomes null. */
export function int(form: FormData, name: string): number | null {
  const v = text(form, name);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Reads a decimal number field; empty becomes null. */
export function decimal(form: FormData, name: string): number | null {
  const v = text(form, name);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Reads an amount in birr ("12,500.50") and returns santim, or null when empty or invalid. */
export function birr(form: FormData, name: string): number | null {
  const v = text(form, name);
  return v === null ? null : parseBirrToMinor(v);
}

/** Santim to the plain birr text used to prefill an amount field ("12500.50"). */
export function minorToInput(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "";
  const whole = Math.trunc(minor / 100);
  const frac = Math.abs(minor % 100);
  return frac ? `${whole}.${String(frac).padStart(2, "0")}` : String(whole);
}

/** ISO instant to the Addis Ababa local value used by <input type="datetime-local">. */
export function isoToAddisLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 3 * 3600_000);
  return d.toISOString().slice(0, 16);
}
