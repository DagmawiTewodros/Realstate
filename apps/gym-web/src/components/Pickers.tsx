"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api, qs } from "@/lib/api";

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

export interface MemberOption {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

/** Search members by name or phone and pick one. */
export function MemberSearch({ label, onPick, autoFocus }: { label: string; onPick: (m: MemberOption) => void; autoFocus?: boolean }) {
  const c = useTranslations("common");
  const m = useTranslations("members");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberOption[]>([]);
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      api<{ items: MemberOption[] }>(`/members${qs({ q: query.trim(), pageSize: 10 })}`)
        .then((r) => setResults(r.items))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);
  return (
    <div className="field">
      <label htmlFor="member-search">{label}</label>
      <input id="member-search" type="search" autoFocus={autoFocus} placeholder={m("searchPlaceholder")} value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
      {results.length ? (
        <ul className="picker-results" role="listbox">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setResults([]);
                  onPick(r);
                }}
              >
                <strong>{r.name}</strong> · <span className="muted">{r.phone ?? r.email}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : query.trim().length >= 2 ? (
        <span className="hint">{c("noResults")}</span>
      ) : null}
    </div>
  );
}
