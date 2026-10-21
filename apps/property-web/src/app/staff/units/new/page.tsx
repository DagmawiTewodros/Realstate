"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, PageHeader } from "@platform/ui";
import { api } from "@/lib/api";
import { UnitForm } from "@/components/UnitForm";

export default function NewUnitPage() {
  const t = useTranslations("units");
  const router = useRouter();
  return (
    <div className="stack">
      <PageHeader title={t("new")} subtitle={t("newHint")} />
      <Card>
        <UnitForm
          onSave={async (body) => {
            const res = await api<{ unit: { id: string } }>("/units", { method: "POST", json: body });
            router.push(`/staff/units/${res.unit.id}`);
          }}
        />
      </Card>
    </div>
  );
}
