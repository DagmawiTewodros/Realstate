"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, Badge, Button, Card, DataList, PageHeader, SelectField, Stat } from "@platform/ui";
import { api } from "@/lib/api";
import { useAction } from "@/lib/forms";

type Kind = "units" | "customers" | "leads";

interface Preview {
  columns: string[];
  sample: Array<Record<string, string>>;
  rowCount: number;
  fields: Array<{ field: string; required: boolean }>;
  suggestedMapping: Record<string, string>;
}

interface RunResult {
  commit: boolean;
  summary: { total: number; created: number; updated: number; skipped: number; errors: number };
  results: Array<{ row: number; outcome: "created" | "updated" | "skipped" | "error"; key?: string; reason?: string; warning?: string }>;
}

/**
 * Spreadsheet import in three steps: upload and match columns, check (dry run, nothing saved),
 * then import the valid rows. The report can be downloaded as CSV at each step.
 */
export default function ImportsPage() {
  const t = useTranslations("imports");
  const c = useTranslations("common");
  const [kind, setKind] = useState<Kind>("units");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<RunResult | null>(null);
  const action = useAction();

  const reset = () => {
    setPreview(null);
    setResult(null);
    setMapping({});
  };

  const form = (extra?: Record<string, string>) => {
    const fd = new FormData();
    fd.append("file", file!);
    for (const [k, v] of Object.entries(extra ?? {})) fd.append(k, v);
    return fd;
  };

  const loadPreview = async () => {
    if (!file) return;
    const res = await action.run(() => api<Preview>(`/imports/${kind}/preview`, { method: "POST", body: form() }));
    if (res) {
      setPreview(res);
      setMapping(res.suggestedMapping);
      setResult(null);
    }
  };

  const cleanMapping = () => Object.fromEntries(Object.entries(mapping).filter(([, v]) => v));

  const runImport = async (commit: boolean) => {
    if (commit && !window.confirm(t("commitConfirm", { count: (result?.summary.created ?? 0) + (result?.summary.updated ?? 0) }))) return;
    const res = await action.run(() => api<RunResult>(`/imports/${kind}/${commit ? "commit" : "dry-run"}`, { method: "POST", body: form({ mapping: JSON.stringify(cleanMapping()) }) }));
    if (res) setResult(res);
  };

  /** The report is built from the result already on screen, so downloading never runs the import again. */
  const downloadReport = () => {
    if (!result) return;
    // Same rules as the server's CSV export: formula-like text is prefixed with an apostrophe.
    const cell = (v: string | number) => {
      let str = String(v);
      if (typeof v === "string" && /^[=+\-@\t\r]/.test(str)) str = `'${str}`;
      return /[",\r\n']/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const lines = [["Row", "Result", "Key", "Reason", "Warning"], ...result.results.map((r) => [r.row, r.outcome, r.key ?? "", r.reason ?? "", r.warning ?? ""])];
    const csv = `\uFEFF${lines.map((l) => l.map(cell).join(",")).join("\r\n")}\r\n`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `import-${kind}-${result.commit ? "result" : "check"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const missing = preview?.fields.filter((f) => f.required && !mapping[f.field]).map((f) => f.field) ?? [];
  const tone = (o: string) => (o === "error" ? "danger" : o === "skipped" ? "warn" : "ok") as "danger" | "warn" | "ok";

  return (
    <div className="stack">
      <PageHeader title={t("title")} subtitle={t("intro")} />
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}
      <Card title={t("step1")}>
        <div className="stack">
          <SelectField
            label={t("kind")}
            value={kind}
            onChange={(ev) => {
              setKind(ev.target.value as Kind);
              reset();
            }}
            options={[
              { value: "units", label: t("kindUnits") },
              { value: "customers", label: t("kindCustomers") },
              { value: "leads", label: t("kindLeads") },
            ]}
          />
          <div className="field">
            <label htmlFor="import-file">{t("file")}</label>
            <input
              id="import-file"
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(ev) => {
                setFile(ev.target.files?.[0] ?? null);
                reset();
              }}
            />
            <span className="hint">{t("fileHint")}</span>
          </div>
          <div>
            <Button onClick={() => void loadPreview()} disabled={!file || action.busy}>
              {t("readFile")}
            </Button>
          </div>
        </div>
      </Card>

      {preview ? (
        <Card title={t("step2")}>
          <div className="stack">
            <p className="small muted">{t("rowsFound", { count: preview.rowCount })}</p>
            <div className="mapping">
              {preview.fields.map((f) => (
                <SelectField
                  key={f.field}
                  label={`${t(`field.${f.field}`)}${f.required ? " *" : ""}`}
                  value={mapping[f.field] ?? ""}
                  onChange={(ev) => {
                    setMapping((m) => ({ ...m, [f.field]: ev.target.value }));
                    setResult(null);
                  }}
                  options={[{ value: "", label: t("notInFile") }, ...preview.columns.map((col) => ({ value: col, label: col }))]}
                />
              ))}
            </div>
            {missing.length ? <Alert kind="warn">{t("mapRequired", { fields: missing.map((m) => t(`field.${m}`)).join(", ") })}</Alert> : null}
            {preview.sample.length ? (
              <details>
                <summary>{t("sample")}</summary>
                <div className="scroll-x">
                  <table className="datalist">
                    <thead>
                      <tr>
                        {preview.columns.map((col) => (
                          <th key={col}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sample.map((row, i) => (
                        <tr key={i}>
                          {preview.columns.map((col) => (
                            <td key={col} data-label={col}>
                              {row[col]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
            <div className="row">
              <Button onClick={() => void runImport(false)} disabled={missing.length > 0 || action.busy}>
                {t("check")}
              </Button>
              {result && !result.commit && result.summary.created + result.summary.updated > 0 ? (
                <Button onClick={() => void runImport(true)} disabled={action.busy}>
                  {t("commit", { count: result.summary.created + result.summary.updated })}
                </Button>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      {result ? (
        <Card title={result.commit ? t("doneTitle") : t("checkTitle")}>
          <div className="stack">
            {result.commit ? <Alert kind="ok">{t("doneText")}</Alert> : <Alert>{t("checkText")}</Alert>}
            <div className="grid cols-4">
              <Stat label={t("created")} value={result.summary.created} />
              <Stat label={t("updated")} value={result.summary.updated} />
              <Stat label={t("skipped")} value={result.summary.skipped} />
              <Stat label={t("errors")} value={result.summary.errors} tone={result.summary.errors ? "danger" : undefined} />
            </div>
            <div>
              <Button variant="secondary" onClick={downloadReport}>
                {c("exportCsv")}
              </Button>
            </div>
            <DataList
              rows={result.results.filter((r) => r.outcome === "error" || r.warning).slice(0, 200)}
              rowKey={(r) => String(r.row)}
              columns={[
                { key: "row", label: t("row"), render: (r) => r.row },
                { key: "outcome", label: t("result"), render: (r) => <Badge tone={tone(r.outcome)}>{t(`outcome.${r.outcome}`)}</Badge> },
                { key: "key", label: t("key"), render: (r) => r.key ?? "-" },
                { key: "reason", label: t("reason"), render: (r) => r.reason ?? r.warning ?? "" },
              ]}
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
