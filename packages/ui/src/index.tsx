"use client";

import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { formatDate, formatDateTime, formatMoney, type Locale } from "@platform/shared";

let fieldCounter = 0;
function useFieldId(id?: string) {
  const [generated] = useState(() => `f${++fieldCounter}`);
  return id ?? generated;
}

export function Button({ variant = "primary", size, block, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger"; size?: "small"; block?: boolean }) {
  const cls = ["btn", variant !== "primary" ? variant : "", size ?? "", block ? "block" : "", rest.className ?? ""].filter(Boolean).join(" ");
  return <button type="button" {...rest} className={cls} />;
}

interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
}

export function TextField({ label, hint, error, id, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const fid = useFieldId(id);
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      <input id={fid} aria-invalid={error ? true : undefined} aria-describedby={error ? `${fid}-err` : undefined} {...rest} />
      {hint ? <span className="hint">{hint}</span> : null}
      {error ? (
        <span className="error" id={`${fid}-err`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function TextArea({ label, hint, error, id, ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const fid = useFieldId(id);
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      <textarea id={fid} aria-invalid={error ? true : undefined} {...rest} />
      {hint ? <span className="hint">{hint}</span> : null}
      {error ? <span className="error">{error}</span> : null}
    </div>
  );
}

export function SelectField({
  label,
  hint,
  error,
  id,
  options,
  ...rest
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement> & { options: Array<{ value: string; label: string }> }) {
  const fid = useFieldId(id);
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      <select id={fid} aria-invalid={error ? true : undefined} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? <span className="hint">{hint}</span> : null}
      {error ? <span className="error">{error}</span> : null}
    </div>
  );
}

export function Checkbox({ label, id, ...rest }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  const fid = useFieldId(id);
  return (
    <div className="check">
      <input type="checkbox" id={fid} {...rest} />
      <label htmlFor={fid}>{label}</label>
    </div>
  );
}

export function Card({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <section className={["card", className].filter(Boolean).join(" ")}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}

export function PageHeader({ title, actions, subtitle }: { title: string; actions?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="spread" style={{ marginBottom: 16 }}>
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

export function Alert({ kind = "info", children }: { kind?: "info" | "error" | "ok" | "warn"; children: ReactNode }) {
  return (
    <div className={`alert ${kind === "info" ? "" : kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Badge({ tone, children }: { tone?: "ok" | "warn" | "danger" | "brand"; children: ReactNode }) {
  return <span className={`badge ${tone ?? ""}`}>{children}</span>;
}

export function Loading({ label }: { label: string }) {
  return (
    <p className="muted" role="status" aria-live="polite">
      {label}
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card" style={{ textAlign: "center" }}>
      <p>
        <strong>{title}</strong>
      </p>
      {children}
    </div>
  );
}

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
}

/** A table on wide screens that turns into one card per row on phones (each cell shows its label). */
export function DataList<T>({ columns, rows, rowKey, caption }: { columns: Array<Column<T>>; rows: T[]; rowKey: (row: T) => string; caption?: string }) {
  return (
    <table className="datalist">
      {caption ? <caption className="visually-hidden">{caption}</caption> : null}
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col">
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((c) => (
              <td key={c.key} data-label={c.label}>
                {c.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Ethiopian date with the Gregorian date alongside. Accepts "YYYY-MM-DD" or an ISO instant. */
export function LocalDate({ value, locale, withTime }: { value: string | Date | null | undefined; locale: Locale; withTime?: boolean }) {
  if (!value) return <span className="muted">-</span>;
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(value);
  const text = withTime && date instanceof Date ? formatDateTime(date, locale) : formatDate(date, locale);
  return <time dateTime={typeof value === "string" ? value : value.toISOString()}>{text}</time>;
}

export function Money({ minor, locale }: { minor: number | null | undefined; locale: Locale }) {
  if (minor === null || minor === undefined) return <span className="muted">-</span>;
  return <span>{formatMoney(minor, locale)}</span>;
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "danger" | "ok" }) {
  return (
    <div className="card stat">
      <span className="muted small">{label}</span>
      <span className="value" style={tone === "danger" ? { color: "var(--danger)" } : tone === "ok" ? { color: "var(--ok)" } : undefined}>
        {value}
      </span>
    </div>
  );
}

/** A simple horizontal bar chart (no chart library), labelled for screen readers. */
export function Bars({ items, format }: { items: Array<{ label: string; value: number }>; format?: (v: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {items.map((i) => (
        <li key={i.label}>
          <div className="spread small">
            <span>{i.label}</span>
            <strong>{format ? format(i.value) : i.value}</strong>
          </div>
          <div className="bar" style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }} aria-hidden="true" />
        </li>
      ))}
    </ul>
  );
}

/** True after the first client render: lets pages avoid hydration differences for time-dependent text. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
