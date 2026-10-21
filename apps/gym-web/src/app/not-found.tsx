import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const c = await getTranslations("common");
  const n = await getTranslations("nav");
  return (
    <main>
      <div className="container">
        <section className="card stack">
          <h1>404</h1>
          <p>{c("notFound")}</p>
          <Link href="/">{n("home")}</Link>
        </section>
      </div>
    </main>
  );
}
