"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Alert, Button, Card, LocalDate, PageHeader, TextField } from "@platform/ui";
import { api, ApiError, useApi } from "@/lib/api";
import { isManager, useSession } from "@/lib/session";
import { MemberSearch } from "@/components/Pickers";

interface Result {
  result: "ALLOWED" | "DENIED" | "DUPLICATE";
  deniedReason: string | null;
  override: boolean;
  member: { id: string; name: string; hasPhoto: boolean } | null;
  membership: { planName: string; endDate: string; daysLeft: number | null } | null;
  checkinId: string;
}

type Request = { token: string } | { memberId: string };

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike;
  }
}

/**
 * Front desk check-in. Three ways in: the camera reads the member's QR code, a USB scanner types the code
 * into the code box (ending with Enter), or staff search by name or phone. The result is shown large.
 */
export default function CheckinPage() {
  const t = useTranslations("checkin");
  const c = useTranslations("common");
  const locale = useLocale() as "am" | "en";
  const { user } = useSession();
  const today = useApi<{ items: Array<{ id: string; at: string; method: string; override: boolean; member: { id: string; name: string } }> }>("/checkins/today");
  const [result, setResult] = useState<Result | null>(null);
  const [last, setLast] = useState<Request | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const lastScan = useRef<{ value: string; at: number } | null>(null);
  const manager = isManager(user);
  const reloadToday = today.reload;

  const send = useCallback(
    async (req: Request, overrideReason?: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await api<Result>("/checkins", { method: "POST", json: { ...req, ...(overrideReason ? { overrideReason } : {}) } });
        setResult(res);
        setLast(req);
        void reloadToday();
      } catch (e) {
        setError(e instanceof ApiError ? (e.status === 0 ? t("offline") : e.message) : t("offline"));
      } finally {
        setBusy(false);
        codeRef.current?.focus();
      }
    },
    [t, reloadToday],
  );

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  // Reads frames from the camera while scanning; the same code is ignored for 4 seconds.
  useEffect(() => {
    if (!scanning || !window.BarcodeDetector) return;
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    let stopped = false;
    const tick = async () => {
      if (stopped || !videoRef.current) return;
      try {
        const codes = await detector.detect(videoRef.current);
        const value = codes[0]?.rawValue;
        const now = Date.now();
        if (value && !(lastScan.current && lastScan.current.value === value && now - lastScan.current.at < 4000)) {
          lastScan.current = { value, at: now };
          await send({ token: value });
        }
      } catch {
        // A frame that cannot be read is skipped.
      }
      if (!stopped) setTimeout(() => void tick(), 300);
    };
    void tick();
    return () => {
      stopped = true;
    };
  }, [scanning, send]);

  const startCamera = async () => {
    setCameraError(null);
    if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      setCameraError(t("cameraUnsupported"));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setScanning(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setCameraError(t("cameraDenied"));
    }
  };

  const submitCode = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const input = codeRef.current;
    const token = input?.value.trim() ?? "";
    if (!token) return;
    if (input) input.value = "";
    await send({ token });
  };

  const submitOverride = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (!last) return;
    const reason = String(new FormData(ev.currentTarget).get("reason") ?? "").trim();
    if (reason.length < 3) return setError(t("reasonRequired"));
    await send(last, reason);
  };

  const items = today.data?.items ?? [];

  return (
    <div className="stack">
      <PageHeader title={t("title")} subtitle={t("visitsToday", { count: items.length })} />
      {error ? <Alert kind="error">{error}</Alert> : null}

      {result ? (
        <div className={`big-result ${result.result === "ALLOWED" ? "allowed" : "denied"}`} role="status" aria-live="assertive" data-result={result.result}>
          <div className="stack" style={{ alignItems: "center", gap: 8 }}>
            {result.member?.hasPhoto ? (
              <img src={`/api/members/${result.member.id}/photo`} alt="" width={120} height={120} style={{ borderRadius: "50%", objectFit: "cover", width: 120, height: 120 }} />
            ) : null}
            <span>{result.result === "ALLOWED" ? (result.override ? t("allowedOverride") : t("allowed")) : result.result === "DUPLICATE" ? t("duplicate") : t("denied")}</span>
            {result.member ? <span style={{ fontSize: "1.2rem" }}>{result.member.name}</span> : null}
            {result.deniedReason && !result.override ? <span style={{ fontSize: "1rem" }}>{t(`reason.${result.deniedReason}`)}</span> : null}
            {result.membership ? (
              <span className="small" style={{ fontWeight: 400 }}>
                {result.membership.planName} · {t("until")} <LocalDate value={result.membership.endDate} locale={locale} />
                {result.membership.daysLeft !== null ? ` · ${t("daysLeft", { count: result.membership.daysLeft })}` : ""}
              </span>
            ) : null}
            {result.member ? (
              <Link href={`/desk/members/${result.member.id}`} className="small">
                {t("openMember")}
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      {result?.result === "DENIED" && result.member && manager ? (
        <Card title={t("override")}>
          <form className="stack" onSubmit={(ev) => void submitOverride(ev)}>
            <TextField label={t("overrideReason")} name="reason" required minLength={3} hint={t("overrideHint")} />
            <div>
              <Button type="submit" variant="danger" disabled={busy}>
                {t("letIn")}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <div className="grid cols-2">
        <Card title={t("scan")}>
          <div className="stack">
            {scanning ? (
              <>
                <video ref={videoRef} playsInline muted style={{ width: "100%", borderRadius: 8, background: "#000" }} />
                <Button variant="secondary" onClick={stopCamera}>
                  {t("stopCamera")}
                </Button>
              </>
            ) : (
              <Button onClick={() => void startCamera()}>{t("startCamera")}</Button>
            )}
            {cameraError ? <Alert kind="warn">{cameraError}</Alert> : null}
            <form className="stack" onSubmit={(ev) => void submitCode(ev)}>
              <div className="field">
                <label htmlFor="code">{t("code")}</label>
                <input id="code" ref={codeRef} autoComplete="off" autoFocus placeholder={t("codeHint")} />
              </div>
              <div>
                <Button type="submit" variant="secondary" disabled={busy}>
                  {t("checkIn")}
                </Button>
              </div>
            </form>
          </div>
        </Card>
        <Card title={t("manual")}>
          <MemberSearch label={t("findMember")} onPick={(m) => void send({ memberId: m.id })} />
        </Card>
      </div>

      <Card title={t("todayTitle")}>
        {items.length ? (
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 4 }}>
            {items.slice(0, 50).map((v) => (
              <li key={v.id} className="spread small">
                <Link href={`/desk/members/${v.member.id}`}>{v.member.name}</Link>
                <span className="muted">
                  {v.override ? `${t("overrideShort")} · ` : ""}
                  <LocalDate value={v.at} locale={locale} withTime />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{c("none")}</p>
        )}
      </Card>
    </div>
  );
}
