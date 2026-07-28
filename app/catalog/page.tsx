"use client";

import { useEffect, useMemo, useState } from "react";
import { client, listAll, useSession } from "@/lib/amplify";
import type { Schema } from "@/amplify/data/resource";
import { SEED_TESTS } from "@/lib/seedTests";
import { DEPARTMENT_LABEL, SEX_LABEL, fmtMoney, rangeLabel } from "@/lib/lab";

type LabTest = Schema["LabTest"]["type"];

export default function CatalogPage() {
  const session = useSession();
  const [tests, setTests] = useState<LabTest[]>([]);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    setTests(
      await listAll<LabTest>((nextToken) =>
        client.models.LabTest.list({ limit: 500, nextToken })
      )
    );
    setLoading(false);
  }

  useEffect(() => {
    load().catch((e) => {
      setMsg(String(e));
      setLoading(false);
    });
  }, []);

  async function seed() {
    setBusy(true);
    setMsg("");
    try {
      const existing = new Set(tests.map((t) => t.code));
      const missing = SEED_TESTS.filter((t) => !existing.has(t.code));
      if (!missing.length) {
        setMsg("الكتالوج محمّل بالكامل — لا يوجد ما يُضاف.");
        return;
      }
      let added = 0;
      for (const t of missing) {
        const { errors } = await client.models.LabTest.create({
          code: t.code,
          nameAr: t.nameAr,
          nameEn: t.nameEn,
          department: t.department,
          resultType: t.resultType,
          unit: t.unit,
          sampleType: t.sampleType,
          price: t.price,
          options: t.options,
          ranges: t.ranges?.map((r) => ({
            sex: r.sex ?? null,
            ageMinYears: r.ageMinYears ?? null,
            ageMaxYears: r.ageMaxYears ?? null,
            low: r.low ?? null,
            high: r.high ?? null,
            text: r.text ?? null,
          })),
          criticalLow: t.criticalLow,
          criticalHigh: t.criticalHigh,
          panelOf: t.panelOf,
          sortOrder: t.sortOrder,
          active: true,
        });
        if (errors?.length) throw new Error(errors[0].message);
        added++;
      }
      setMsg(`تمت إضافة ${added} فحصًا إلى الكتالوج.`);
      await load();
    } catch (e) {
      setMsg(`تعذّر التحميل: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(t: LabTest) {
    await client.models.LabTest.update({ id: t.id, active: !t.active });
    await load();
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return tests
      .filter((t) => (dept ? t.department === dept : true))
      .filter((t) =>
        term
          ? t.nameAr?.toLowerCase().includes(term) ||
            t.nameEn?.toLowerCase().includes(term) ||
            t.code?.toLowerCase().includes(term)
          : true
      )
      .sort((a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100));
  }, [tests, q, dept]);

  const canManage = session.can("manageCatalog");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>كتالوج الفحوصات</h1>
          <p>{tests.length} فحص معرّف · المديات المرجعية تُطبَّق تلقائيًا حسب جنس المريض وعمره</p>
        </div>
        {canManage && (
          <button className="btn primary" onClick={seed} disabled={busy}>
            {busy ? "جارٍ التحميل…" : "تحميل الكتالوج الافتراضي"}
          </button>
        )}
      </div>

      {msg && <div className="alert">{msg}</div>}

      {tests.length === 0 && !loading && (
        <div className="alert warn">
          الكتالوج فارغ.{" "}
          {canManage ? (
            "اضغط «تحميل الكتالوج الافتراضي» لإضافة ٤٠ فحصًا شائعًا مع مدياتها المرجعية."
          ) : (
            <>
              تحميل الكتالوج متاح لمجموعة <span className="mono">admin</span> فقط —
              أضف حسابك إلى هذه المجموعة في Cognito (راجع ملف{" "}
              <span className="mono">LAB_README.md</span>).
            </>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div className="row">
            <input
              style={{ maxWidth: 280 }}
              placeholder="بحث بالاسم أو الكود…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              style={{ maxWidth: 200 }}
              value={dept}
              onChange={(e) => setDept(e.target.value)}
            >
              <option value="">كل الأقسام</option>
              {Object.entries(DEPARTMENT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <span className="muted small">{filtered.length} فحص</span>
        </div>

        {loading ? (
          <p className="muted">جارٍ التحميل…</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>الكود</th>
                  <th>الفحص</th>
                  <th>القسم</th>
                  <th>الوحدة</th>
                  <th>المدى المرجعي</th>
                  <th>حرج</th>
                  <th className="num">السعر</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} style={{ opacity: t.active === false ? 0.45 : 1 }}>
                    <td className="mono nowrap">{t.code}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{t.nameAr}</div>
                      <div className="small muted">{t.nameEn}</div>
                      {(t.panelOf?.length ?? 0) > 0 && (
                        <span className="badge info">
                          باقة: {t.panelOf?.join("، ")}
                        </span>
                      )}
                    </td>
                    <td className="small nowrap">
                      {DEPARTMENT_LABEL[t.department ?? ""] ?? "—"}
                    </td>
                    <td className="small nowrap">{t.unit || "—"}</td>
                    <td className="small">
                      {(t.ranges ?? []).length === 0
                        ? "—"
                        : (t.ranges ?? []).map((r, i) => (
                            <div key={i} className="nowrap">
                              {r?.sex ? `${SEX_LABEL[r.sex]}: ` : ""}
                              {r?.ageMaxYears != null && !r?.sex
                                ? `< ${r.ageMaxYears} سنة: `
                                : ""}
                              {rangeLabel(r?.low, r?.high, r?.text)}
                            </div>
                          ))}
                    </td>
                    <td className="small nowrap">
                      {t.criticalLow != null || t.criticalHigh != null ? (
                        <span className="badge critical">
                          {t.criticalLow != null ? `≤ ${t.criticalLow}` : ""}
                          {t.criticalLow != null && t.criticalHigh != null ? " أو " : ""}
                          {t.criticalHigh != null ? `≥ ${t.criticalHigh}` : ""}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num nowrap">{fmtMoney(t.price)}</td>
                    <td>
                      {canManage && (
                        <button className="btn sm" onClick={() => toggleActive(t)}>
                          {t.active === false ? "تفعيل" : "إيقاف"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
