"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { SelectField } from "@platform/ui";
import { api, qs, useApi } from "@/lib/api";

/** Previous / next page buttons with "page X of Y". */
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const c = useTranslations("common");
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="row" aria-label="Pages" style={{ justifyContent: "center", marginTop: 12 }}>
      <button type="button" className="btn secondary small" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {c("previous")}
      </button>
      <span className="small muted">{c("page", { page, pages })}</span>
      <button type="button" className="btn secondary small" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {c("next")}
      </button>
    </nav>
  );
}

export interface StaffMember {
  id: string;
  name: string;
  role: string;
}

/** Active staff, optionally limited to some roles (for example brokers and sales managers for lead assignment). */
export function StaffSelect({
  label,
  name,
  roles,
  defaultValue,
  allowEmpty,
  value,
  onChange,
}: {
  label: string;
  name: string;
  roles?: string[];
  defaultValue?: string | null;
  allowEmpty?: boolean;
  value?: string;
  onChange?: (v: string) => void;
}) {
  const c = useTranslations("common");
  const { data } = useApi<{ items: StaffMember[] }>("/staff");
  const items = (data?.items ?? []).filter((s) => !roles || roles.includes(s.role));
  const options = [...(allowEmpty ? [{ value: "", label: c("none") }] : []), ...items.map((s) => ({ value: s.id, label: s.name }))];
  if (!data) return <SelectField label={label} name={name} options={[{ value: "", label: c("loading") }]} disabled />;
  return (
    <SelectField
      label={label}
      name={name}
      options={options}
      {...(value !== undefined ? { value, onChange: (e) => onChange?.(e.target.value) } : { defaultValue: defaultValue ?? "" })}
    />
  );
}

interface UnitOption {
  id: string;
  code: string;
  status: string;
  project: { name: string; area: string };
}

/** Search units by code, project, or area and pick one. The chosen id is submitted under `name`. */
export function UnitPicker({
  label,
  name,
  initial,
  status,
  onPick,
}: {
  label: string;
  name: string;
  initial?: { id: string; code: string } | null;
  status?: string;
  onPick?: (unit: { id: string; code: string } | null) => void;
}) {
  const c = useTranslations("common");
  const u = useTranslations("units");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UnitOption[]>([]);
  const [picked, setPicked] = useState<{ id: string; code: string } | null>(initial ?? null);

  useEffect(() => {
    if (query.trim().length < 1) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      api<{ items: UnitOption[] }>(`/units${qs({ q: query.trim(), pageSize: 10, status })}`)
        .then((r) => setResults(r.items))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query, status]);

  const choose = (unit: { id: string; code: string } | null) => {
    setPicked(unit);
    setQuery("");
    setResults([]);
    onPick?.(unit);
  };

  return (
    <div className="field">
      <span className="label">{label}</span>
      <input type="hidden" name={name} value={picked?.id ?? ""} />
      {picked ? (
        <div className="row">
          <span className="badge brand">{picked.code}</span>
          <button type="button" className="btn secondary small" onClick={() => choose(null)}>
            {u("clearUnit")}
          </button>
        </div>
      ) : (
        <>
          <input type="search" aria-label={label} placeholder={u("searchUnit")} value={query} onChange={(e) => setQuery(e.target.value)} />
          {results.length ? (
            <ul className="picker-results" role="listbox">
              {results.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => choose({ id: r.id, code: `${r.project.name} ${r.code}` })}>
                    <strong>{r.code}</strong> · {r.project.name} · <span className="muted">{r.project.area}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : query ? (
            <span className="hint">{c("noResults")}</span>
          ) : null}
        </>
      )}
    </div>
  );
}

interface CustomerOption {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

/** Search customers by name, phone, or email and pick one. */
export function CustomerPicker({
  label,
  name,
  initial,
  onPick,
}: {
  label: string;
  name: string;
  initial?: { id: string; name: string } | null;
  onPick?: (c: CustomerOption | null) => void;
}) {
  const c = useTranslations("common");
  const cu = useTranslations("customers");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerOption[]>([]);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(initial ?? null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      api<{ items: CustomerOption[] }>(`/customers${qs({ q: query.trim(), pageSize: 10 })}`)
        .then((r) => setResults(r.items))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const choose = (cust: CustomerOption | null) => {
    setPicked(cust ? { id: cust.id, name: cust.name } : null);
    setQuery("");
    setResults([]);
    onPick?.(cust);
  };

  return (
    <div className="field">
      <span className="label">{label}</span>
      <input type="hidden" name={name} value={picked?.id ?? ""} />
      {picked ? (
        <div className="row">
          <span className="badge brand">{picked.name}</span>
          <button type="button" className="btn secondary small" onClick={() => choose(null)}>
            {cu("change")}
          </button>
        </div>
      ) : (
        <>
          <input type="search" aria-label={label} placeholder={cu("searchPlaceholder")} value={query} onChange={(e) => setQuery(e.target.value)} />
          {results.length ? (
            <ul className="picker-results" role="listbox">
              {results.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => choose(r)}>
                    <strong>{r.name}</strong> · <span className="muted">{r.phone ?? r.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : query.trim().length >= 2 ? (
            <span className="hint">{c("noResults")}</span>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Property owners (landlords). Empty means "use the unit's owner" on new leases. */
export function LandlordSelect({ label, name, defaultValue, emptyLabel }: { label: string; name: string; defaultValue?: string | null; emptyLabel?: string }) {
  const c = useTranslations("common");
  const { data } = useApi<{ items: Array<{ id: string; name: string }> }>("/landlords");
  if (!data) return <SelectField label={label} name={name} options={[{ value: "", label: c("loading") }]} disabled />;
  return (
    <SelectField
      label={label}
      name={name}
      defaultValue={defaultValue ?? ""}
      options={[{ value: "", label: emptyLabel ?? c("none") }, ...data.items.map((l) => ({ value: l.id, label: l.name }))]}
    />
  );
}
