import { getTranslations } from "next-intl/server";
import { UNIT_PURPOSES, UNIT_TYPES } from "@platform/shared";

/** A plain GET form: works without JavaScript and keeps the filters in the URL. */
export async function SearchForm({ values = {} }: { values?: Record<string, string | undefined> }) {
  const t = await getTranslations("public");
  const e = await getTranslations("enums");
  const c = await getTranslations("common");
  return (
    <form action="/listings" method="get" className="card stack" aria-label={t("searchTitle")}>
      <div className="grid cols-3">
        <div className="field">
          <label htmlFor="s-purpose">{t("purpose")}</label>
          <select id="s-purpose" name="purpose" defaultValue={values.purpose ?? ""}>
            <option value="">{c("all")}</option>
            {UNIT_PURPOSES.map((p) => (
              <option key={p} value={p}>
                {e(`UNIT_PURPOSE.${p}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="s-type">{t("type")}</label>
          <select id="s-type" name="type" defaultValue={values.type ?? ""}>
            <option value="">{c("all")}</option>
            {UNIT_TYPES.map((p) => (
              <option key={p} value={p}>
                {e(`UNIT_TYPE.${p}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="s-area">{t("area")}</label>
          <input id="s-area" name="area" defaultValue={values.area ?? ""} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="s-min">{t("minPrice")}</label>
          <input id="s-min" name="min" inputMode="numeric" pattern="[0-9]*" defaultValue={values.min ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="s-max">{t("maxPrice")}</label>
          <input id="s-max" name="max" inputMode="numeric" pattern="[0-9]*" defaultValue={values.max ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="s-bed">{t("bedrooms")}</label>
          <select id="s-bed" name="bedrooms" defaultValue={values.bedrooms ?? ""}>
            <option value="">{c("all")}</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}+
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <button type="submit" className="btn">
          {c("search")}
        </button>
      </div>
    </form>
  );
}
