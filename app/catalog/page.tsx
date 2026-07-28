"use client";

import { useEffect, useMemo, useState } from "react";
import { audit, client, listAll, useSession } from "@/lib/amplify";
import type { Schema } from "@/amplify/data/resource";
import { useLabConfig } from "@/lib/config";
import { SEED_TESTS } from "@/lib/seedTests";
import { DEPARTMENT_LABEL, SEX_LABEL, fmtMoney, rangeLabel } from "@/lib/lab";

type LabTest = Schema["LabTest"]["type"];

const RESULT_TYPE_LABEL: Record<string, string> = {
  NUMERIC: "رقمي",
  TEXT: "نصّي",
  OPTION: "اختيار من قائمة",
};

/** مسوّدة نموذج التحرير — كل الحقول نصوص لأنها قادمة من `<input>`. */
type Draft = {
  id?: string;
  code: string;
  nameAr: string;
  nameEn: string;
  department: string;
  resultType: string;
  unit: string;
  sampleType: string;
  tubeType: string;
  price: string;
  criticalLow: string;
  criticalHigh: string;
  sortOrder: string;
  options: string;
  active: boolean;
};

const EMPTY_DRAFT: Draft = {
  code: "",
  nameAr: "",
  nameEn: "",
  department: "CHEMISTRY",
  resultType: "NUMERIC",
  unit: "",
  sampleType: "",
  tubeType: "",
  price: "0",
  criticalLow: "",
  criticalHigh: "",
  sortOrder: "100",
  options: "",
  active: true,
};

function toDraft(t: LabTest): Draft {
  return {
    id: t.id,
    code: t.code ?? "",
    nameAr: t.nameAr ?? "",
    nameEn: t.nameEn ?? "",
    department: t.department ?? "CHEMISTRY",
    resultType: t.resultType ?? "NUMERIC",
    unit: t.unit ?? "",
    sampleType: t.sampleType ?? "",
    tubeType: t.tubeType ?? "",
    price: String(t.price ?? 0),
    criticalLow: t.criticalLow == null ? "" : String(t.criticalLow),
    criticalHigh: t.criticalHigh == null ? "" : String(t.criticalHigh),
    sortOrder: String(t.sortOrder ?? 100),
    options: (t.options ?? []).filter(Boolean).join("، "),
    active: t.active !== false,
  };
}

const num = (s: string): number | null => {
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) ? v : null;
};

export default function CatalogPage() {
  const session = useSession();
  const cfg = useLabConfig();
  const [tests, setTests] = useState<LabTest[]>([]);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  /* أسعار قيد التحرير المباشر في الجدول: مفتاحها معرّف الفحص. الفصل عن
     `tests` مقصود — لا نكتب في الحالة المعروضة قبل أن يقبل الخادم. */
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});

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
          tubeType: t.tubeType,
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

  /** حفظ سعر عُدّل مباشرة في الجدول. */
  async function savePrice(t: LabTest) {
    const raw = priceDraft[t.id];
    if (raw === undefined) return;
    const value = num(raw);
    setPriceDraft(({ [t.id]: _drop, ...rest }) => rest);
    if (value === null || value < 0 || value === (t.price ?? 0)) return;
    try {
      const { errors } = await client.models.LabTest.update({
        id: t.id,
        price: value,
      });
      if (errors?.length) throw new Error(errors[0].message);
      // السعر يمسّ فاتورة المريض، فتغييره يُسجَّل باسم من غيّره.
      await audit({
        entity: "LabTest",
        entityId: t.id,
        action: "PRICE_CHANGED",
        actor: session.actor,
        summary: `${t.code}: ${fmtMoney(t.price)} ← ${fmtMoney(value)}`,
        before: { price: t.price },
        after: { price: value },
      });
      setMsg(`حُدّث سعر ${t.nameAr} إلى ${fmtMoney(value)}.`);
      await load();
    } catch (e) {
      setMsg(`تعذّر حفظ السعر: ${(e as Error).message}`);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    const code = draft.code.trim().toUpperCase();
    const nameAr = draft.nameAr.trim();
    if (!code || !nameAr) {
      setMsg("الكود والاسم العربي مطلوبان.");
      return;
    }
    // الكود هو ما يُطبع ويُربط به الفحص في الطلبات القديمة؛ تكراره يخلط
    // فحصين في التقارير والإحصاءات.
    const clash = tests.find(
      (t) => t.code?.trim().toUpperCase() === code && t.id !== draft.id
    );
    if (clash) {
      setMsg(`الكود ${code} مستخدم بالفعل في «${clash.nameAr}».`);
      return;
    }

    setBusy(true);
    setMsg("");
    try {
      const payload = {
        code,
        nameAr,
        nameEn: draft.nameEn.trim() || undefined,
        department: draft.department as LabTest["department"],
        resultType: draft.resultType as LabTest["resultType"],
        unit: draft.unit.trim() || undefined,
        sampleType: draft.sampleType.trim() || undefined,
        tubeType: draft.tubeType.trim() || undefined,
        price: num(draft.price) ?? 0,
        criticalLow: num(draft.criticalLow),
        criticalHigh: num(draft.criticalHigh),
        sortOrder: Math.round(num(draft.sortOrder) ?? 100),
        options:
          draft.resultType === "OPTION"
            ? draft.options
                .split(/[،,\n]/)
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        active: draft.active,
      };

      const before = draft.id ? tests.find((t) => t.id === draft.id) : undefined;
      const res = draft.id
        ? await client.models.LabTest.update({ id: draft.id, ...payload })
        : await client.models.LabTest.create(payload);
      if (res.errors?.length) throw new Error(res.errors[0].message);

      await audit({
        entity: "LabTest",
        entityId: res.data?.id ?? draft.id ?? code,
        action: draft.id ? "TEST_UPDATED" : "TEST_CREATED",
        actor: session.actor,
        summary: `${code} — ${nameAr}`,
        before: before && {
          nameAr: before.nameAr,
          price: before.price,
          sampleType: before.sampleType,
          tubeType: before.tubeType,
        },
        after: {
          nameAr: payload.nameAr,
          price: payload.price,
          sampleType: payload.sampleType,
          tubeType: payload.tubeType,
        },
      });

      setMsg(draft.id ? `حُفظ الفحص ${code}.` : `أُضيف الفحص ${code}.`);
      setDraft(null);
      await load();
    } catch (e) {
      setMsg(`تعذّر الحفظ: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
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
          <p>
            {tests.length} فحص معرّف · المديات المرجعية تُطبَّق تلقائيًا حسب جنس
            المريض وعمره
          </p>
        </div>
        {canManage && (
          <div className="row">
            <button
              className="btn primary"
              onClick={() => {
                setDraft({ ...EMPTY_DRAFT });
                setMsg("");
              }}
            >
              + فحص جديد
            </button>
            <button className="btn" onClick={seed} disabled={busy}>
              {busy ? "جارٍ…" : "تحميل الكتالوج الافتراضي"}
            </button>
          </div>
        )}
      </div>

      {msg && <div className="alert">{msg}</div>}

      {tests.length === 0 && !loading && (
        <div className="alert warn">
          الكتالوج فارغ.{" "}
          {canManage ? (
            "اضغط «تحميل الكتالوج الافتراضي» لإضافة ٤٠ فحصًا شائعًا مع مدياتها المرجعية، أو أضف فحصًا يدويًا."
          ) : (
            <>
              تحميل الكتالوج متاح لمجموعة <span className="mono">admin</span> فقط —
              أضف حسابك إلى هذه المجموعة في Cognito (راجع ملف{" "}
              <span className="mono">LAB_README.md</span>).
            </>
          )}
        </div>
      )}

      {draft && (
        <TestEditor
          draft={draft}
          setDraft={setDraft}
          onSave={saveDraft}
          busy={busy}
          sampleTypes={cfg.sampleTypes}
          tubeTypes={cfg.tubeTypes}
          currency={cfg.currency}
        />
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
                  <th>العيّنة والأنبوب</th>
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
                      <div>{t.sampleType || "—"}</div>
                      {t.tubeType && (
                        <div className="muted nowrap">🧪 {t.tubeType}</div>
                      )}
                    </td>
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
                          {t.criticalLow != null && t.criticalHigh != null
                            ? " أو "
                            : ""}
                          {t.criticalHigh != null ? `≥ ${t.criticalHigh}` : ""}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num nowrap">
                      {canManage ? (
                        <div className="row" style={{ justifyContent: "flex-end" }}>
                          <input
                            className="num"
                            style={{ maxWidth: 90, textAlign: "end" }}
                            inputMode="decimal"
                            value={priceDraft[t.id] ?? String(t.price ?? 0)}
                            onChange={(e) =>
                              setPriceDraft((p) => ({ ...p, [t.id]: e.target.value }))
                            }
                            onBlur={() => savePrice(t)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                              if (e.key === "Escape")
                                setPriceDraft(({ [t.id]: _d, ...rest }) => rest);
                            }}
                            aria-label={`سعر ${t.nameAr}`}
                          />
                          <span className="small muted">{cfg.currency}</span>
                        </div>
                      ) : (
                        fmtMoney(t.price)
                      )}
                    </td>
                    <td className="nowrap">
                      {canManage && (
                        <div className="row">
                          <button
                            className="btn sm"
                            onClick={() => {
                              setDraft(toDraft(t));
                              setMsg("");
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                          >
                            تعديل
                          </button>
                          <button className="btn sm ghost" onClick={() => toggleActive(t)}>
                            {t.active === false ? "تفعيل" : "إيقاف"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canManage && (
        <p className="small muted" style={{ marginTop: 10 }}>
          السعر يُحفظ فور الخروج من الخانة. تعديل السعر أو الاسم لا يغيّر الطلبات
          السابقة — كل طلب يحتفظ بنسخة من بيانات الفحص وقت تسجيله.
        </p>
      )}
    </>
  );
}

/* ── نموذج تحرير فحص ──────────────────────────────────────────── */

function TestEditor({
  draft,
  setDraft,
  onSave,
  busy,
  sampleTypes,
  tubeTypes,
  currency,
}: {
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  onSave: () => void;
  busy: boolean;
  sampleTypes: string[];
  tubeTypes: string[];
  currency: string;
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft({ ...draft, [k]: v });

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <h2>{draft.id ? `تعديل الفحص ${draft.code}` : "فحص جديد"}</h2>
        <button className="btn sm ghost" onClick={() => setDraft(null)}>
          إلغاء
        </button>
      </div>

      <div className="grid cols-3">
        <div className="field">
          <label>الكود *</label>
          <input
            className="mono"
            value={draft.code}
            onChange={(e) => set("code", e.target.value)}
            placeholder="GLU"
          />
          <div className="hint">يُطبع على الباركود ويُميّز الفحص — لا يتكرّر.</div>
        </div>

        <div className="field">
          <label>الاسم بالعربية *</label>
          <input
            value={draft.nameAr}
            onChange={(e) => set("nameAr", e.target.value)}
            placeholder="سكر الدم صائم"
          />
        </div>

        <div className="field">
          <label>الاسم بالإنجليزية</label>
          <input
            value={draft.nameEn}
            onChange={(e) => set("nameEn", e.target.value)}
            placeholder="Fasting Blood Glucose"
          />
        </div>

        <div className="field">
          <label>القسم</label>
          <select
            value={draft.department}
            onChange={(e) => set("department", e.target.value)}
          >
            {Object.entries(DEPARTMENT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>نوع النتيجة</label>
          <select
            value={draft.resultType}
            onChange={(e) => set("resultType", e.target.value)}
          >
            {Object.entries(RESULT_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>الوحدة</label>
          <input
            value={draft.unit}
            onChange={(e) => set("unit", e.target.value)}
            placeholder="mg/dL"
          />
        </div>

        <div className="field">
          <label>نوع العيّنة</label>
          <input
            list="sample-types"
            value={draft.sampleType}
            onChange={(e) => set("sampleType", e.target.value)}
            placeholder="دم وريدي"
          />
          <datalist id="sample-types">
            {sampleTypes.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <div className="hint">القائمة من إعدادات المختبر — ويمكن كتابة نوع جديد.</div>
        </div>

        <div className="field">
          <label>نوع الأنبوب (التيوب)</label>
          <input
            list="tube-types"
            value={draft.tubeType}
            onChange={(e) => set("tubeType", e.target.value)}
            placeholder="أنبوب بنفسجي (EDTA)"
          />
          <datalist id="tube-types">
            {tubeTypes.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>

        <div className="field">
          <label>السعر ({currency})</label>
          <input
            inputMode="decimal"
            value={draft.price}
            onChange={(e) => set("price", e.target.value)}
          />
        </div>

        <div className="field">
          <label>حد حرج أدنى</label>
          <input
            inputMode="decimal"
            value={draft.criticalLow}
            onChange={(e) => set("criticalLow", e.target.value)}
            placeholder="اتركه فارغًا إن لم يوجد"
          />
        </div>

        <div className="field">
          <label>حد حرج أعلى</label>
          <input
            inputMode="decimal"
            value={draft.criticalHigh}
            onChange={(e) => set("criticalHigh", e.target.value)}
            placeholder="اتركه فارغًا إن لم يوجد"
          />
        </div>

        <div className="field">
          <label>ترتيب العرض</label>
          <input
            inputMode="numeric"
            value={draft.sortOrder}
            onChange={(e) => set("sortOrder", e.target.value)}
          />
          <div className="hint">الأصغر يظهر أولًا في التقارير والقوائم.</div>
        </div>

        {draft.resultType === "OPTION" && (
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>الخيارات</label>
            <input
              value={draft.options}
              onChange={(e) => set("options", e.target.value)}
              placeholder="إيجابي، سلبي"
            />
            <div className="hint">افصل بين الخيارات بفاصلة.</div>
          </div>
        )}
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={onSave} disabled={busy}>
          {busy ? "جارٍ الحفظ…" : draft.id ? "حفظ التعديلات" : "إضافة الفحص"}
        </button>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(e) => set("active", e.target.checked)}
          />
          مفعّل
        </label>
      </div>

      {draft.id && (
        <p className="small muted" style={{ marginTop: 10 }}>
          المديات المرجعية لهذا الفحص تُحرَّر من الكتالوج الافتراضي حاليًا — تعديلها
          هنا لم يُفعَّل بعد.
        </p>
      )}
    </div>
  );
}
