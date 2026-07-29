"use client";

import { useEffect, useState } from "react";
import { audit, client, listAll, useSession } from "@/lib/amplify";
import {
  CURRENCY_PRESETS,
  DEFAULT_SAMPLE_TYPES,
  DEFAULT_TUBE_TYPES,
  useLabConfig,
} from "@/lib/config";
import { dayOf, fmtMoney } from "@/lib/lab";

/**
 * إعدادات المختبر — لمدير المختبر.
 *
 * ما يُدار هنا هو ما يتغيّر بتغيّر المختبر لا بتغيّر الكود: العملة،
 * أنواع العيّنات، وأنواع الأنابيب. تعديل أسعار الفحوصات وأسمائها في
 * صفحة «كتالوج الفحوصات» لأنها خصائص فحص لا خصائص مختبر.
 */
export default function SettingsPage() {
  const session = useSession();
  const cfg = useLabConfig();
  const canManage = session.can("manageCatalog");

  const [labName, setLabName] = useState(cfg.labName);
  const [currency, setCurrency] = useState(cfg.currency);
  const [currencyCode, setCurrencyCode] = useState(cfg.currencyCode);
  const [samples, setSamples] = useState<string[]>(cfg.sampleTypes);
  const [tubes, setTubes] = useState<string[]>(cfg.tubeTypes);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // الإعدادات تصل بعد أول رسم، فتُزامَن الحقول عند وصولها.
  useEffect(() => {
    if (cfg.loading) return;
    setLabName(cfg.labName);
    setCurrency(cfg.currency);
    setCurrencyCode(cfg.currencyCode);
    setSamples(cfg.sampleTypes);
    setTubes(cfg.tubeTypes);
  }, [cfg.loading, cfg.labName, cfg.currency, cfg.currencyCode, cfg.sampleTypes, cfg.tubeTypes]);

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      await cfg.save({
        labName: labName.trim(),
        currency: currency.trim(),
        currencyCode: currencyCode.trim().toUpperCase(),
        sampleTypes: samples,
        tubeTypes: tubes,
      });
      setMsg("حُفظت الإعدادات.");
    } catch (e) {
      setMsg(`تعذّر الحفظ: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (cfg.loading) return <p className="muted">جارٍ التحميل…</p>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>إعدادات المختبر</h1>
          <p>العملة وأنواع العيّنات والأنابيب — تظهر كخيارات جاهزة عند تعريف الفحوصات.</p>
        </div>
        {canManage && (
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
          </button>
        )}
      </div>

      {msg && <div className="alert">{msg}</div>}

      {!canManage && (
        <div className="alert warn">
          تعديل الإعدادات متاح لمدير المختبر (مجموعة <span className="mono">admin</span>)
          فقط. ما تراه هنا للاطّلاع.
        </div>
      )}

      <div className="grid cols-2">
        <div className="card">
          <div className="card-head">
            <h2>المختبر والعملة</h2>
          </div>

          <div className="field">
            <label>اسم المختبر</label>
            <input
              value={labName}
              onChange={(e) => setLabName(e.target.value)}
              disabled={!canManage}
              placeholder="مختبر النور الطبي"
            />
            <div className="hint">يظهر في ترويسة التقارير.</div>
          </div>

          <div className="field">
            <label>العملة</label>
            <div className="row">
              <select
                style={{ maxWidth: 220 }}
                value={
                  CURRENCY_PRESETS.some((c) => c.code === currencyCode)
                    ? currencyCode
                    : ""
                }
                onChange={(e) => {
                  const p = CURRENCY_PRESETS.find((c) => c.code === e.target.value);
                  if (p) {
                    setCurrencyCode(p.code);
                    setCurrency(p.symbol);
                  }
                }}
                disabled={!canManage}
              >
                <option value="">— عملة أخرى —</option>
                {CURRENCY_PRESETS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label} ({c.symbol})
                  </option>
                ))}
              </select>
              <input
                style={{ maxWidth: 110 }}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                disabled={!canManage}
                placeholder="الرمز"
                aria-label="رمز العملة"
              />
              <input
                style={{ maxWidth: 110 }}
                className="mono"
                value={currencyCode}
                onChange={(e) => setCurrencyCode(e.target.value)}
                disabled={!canManage}
                placeholder="SAR"
                aria-label="كود العملة"
              />
            </div>
            <div className="hint">
              المعاينة: {fmtMoney(1250.5, currency)} · كل الأسعار والفواتير تُعرض بهذه
              العملة. تغيير الرمز لا يحوّل المبالغ المحفوظة.
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>أنواع العيّنات</h2>
            <span className="muted small">{samples.length} نوع</span>
          </div>
          <ChipList
            items={samples}
            setItems={setSamples}
            disabled={!canManage}
            placeholder="مثال: سائل مفصلي"
            defaults={DEFAULT_SAMPLE_TYPES}
          />
        </div>

        <div className="card">
          <div className="card-head">
            <h2>أنواع الأنابيب (التيوبات)</h2>
            <span className="muted small">{tubes.length} نوع</span>
          </div>
          <ChipList
            items={tubes}
            setItems={setTubes}
            disabled={!canManage}
            placeholder="مثال: أنبوب وردي (بنك الدم)"
            defaults={DEFAULT_TUBE_TYPES}
          />
        </div>
      </div>

      {canManage && <DayBackfill />}
    </>
  );
}

/* `selectionSet` يقصر الجلب على أربعة حقول: الفحص يمرّ على كل طلب في
   النظام، وجلب الطلب كاملًا يضاعف حجم النقل بلا فائدة. */
type SlimOrder = {
  id: string;
  orderNo: string;
  createdAt: string;
  day: string | null;
};

/**
 * ملء الحقل `day` على الطلبات القديمة.
 *
 * الحقل أُضيف بعد أن كان النظام يعمل، فالطلبات الأقدم منه لا تحمله —
 * وتقارير الإدارة تقرأ عبر فهرس `day`، فتلك الطلبات غائبة عن كل تقرير
 * فترة: إيرادها لا يُحتسب وعدد فحوصها لا يظهر. لا خطأ يُعرض، الأرقام
 * تنقص بصمت وحسب.
 *
 * اليوم يُستخرج من `createdAt` بتوقيت المتصفّح — وهو ما يفعله إنشاء
 * الطلب أصلًا، فيتطابق القديم مع الجديد. لذلك تُشغَّل هذه العملية من
 * جهاز على توقيت المختبر لا من جهاز في منطقة زمنية أخرى.
 *
 * عملية تُشغَّل مرة ثم لا تجد ما تعمله: بعدها تقول «كل الطلبات محدَّثة».
 */
function DayBackfill() {
  const session = useSession();
  const [scan, setScan] = useState<{ total: number; missing: SlimOrder[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [progress, setProgress] = useState(0);

  async function check() {
    setBusy(true);
    setMsg("");
    try {
      const all = await listAll<SlimOrder>((nextToken) =>
        client.models.Order.list({
          limit: 500,
          nextToken,
          selectionSet: ["id", "orderNo", "createdAt", "day"],
        })
      );
      setScan({ total: all.length, missing: all.filter((o) => !o.day) });
    } catch (e) {
      setMsg(`تعذّر الفحص: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!scan?.missing.length) return;
    setBusy(true);
    setMsg("");
    setProgress(0);
    let done = 0;
    let skipped = 0;
    let at = "";
    try {
      for (const o of scan.missing) {
        at = o.orderNo;
        const day = dayOf(o.createdAt);
        if (!day) {
          // طابع زمني مفقود أو تالف: نتركه بلا يوم بدل أن نضعه في يوم
          // مخترَع يشوّه تقرير تلك الفترة.
          skipped++;
          continue;
        }
        const { errors } = await client.models.Order.update({ id: o.id, day });
        if (errors?.length) throw new Error(errors[0].message);
        done++;
        setProgress(done + skipped);
      }

      await audit({
        entity: "Order",
        entityId: "BACKFILL",
        action: "DAY_BACKFILLED",
        actor: session.actor,
        summary: `ملء رجعي للحقل day على ${done} طلب${
          skipped ? ` · ${skipped} تُخطّي لتعذّر قراءة تاريخ إنشائه` : ""
        }`,
      });

      setMsg(
        `اكتمل: حُدّث ${done} طلب${
          skipped ? ` · تُخطّي ${skipped} لتعذّر قراءة تاريخ إنشائه` : ""
        }. صارت هذه الطلبات تظهر في التقارير.`
      );
      await check();
    } catch (e) {
      // كل طلب تحديث مستقل، فما نجح قبل العطل محفوظ فعلًا. إعادة
      // التشغيل تمرّ على الناقص وحده لا على الجميع.
      setMsg(
        `توقّف بعد ${done} طلب عند ${at}: ${(e as Error).message} — ما حُدّث محفوظ، أعد التشغيل للباقي.`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <h2>صيانة البيانات</h2>
        <button className="btn sm" onClick={check} disabled={busy}>
          {busy && !scan ? "جارٍ الفحص…" : "فحص الطلبات"}
        </button>
      </div>

      <p className="muted small" style={{ marginTop: 0 }}>
        الطلبات المنشأة قبل إضافة حقل اليوم (<span className="mono">day</span>) لا
        تظهر في صفحة التقارير — لا في الإيراد ولا في عدد الفحوص. هذا الفحص يعدّها،
        والملء الرجعي يستخرج يوم كل طلب من تاريخ إنشائه.
      </p>

      {msg && <div className="alert">{msg}</div>}

      {scan && (
        <div className="row" style={{ alignItems: "center" }}>
          <span className="badge info">{scan.total} طلب في النظام</span>
          {scan.missing.length === 0 ? (
            <span className="badge ok">كلّها تحمل يومًا — لا حاجة لشيء</span>
          ) : (
            <>
              <span className="badge warn">
                {scan.missing.length} طلب بلا يوم — غائب عن التقارير
              </span>
              <button className="btn primary" onClick={run} disabled={busy}>
                {busy
                  ? `جارٍ التحديث… ${progress}/${scan.missing.length}`
                  : "تشغيل الملء الرجعي"}
              </button>
            </>
          )}
        </div>
      )}

      {scan && scan.missing.length > 0 && !busy && (
        <p className="muted small" style={{ marginBottom: 0 }}>
          يُستخرج اليوم بتوقيت هذا الجهاز — شغّله من جهاز على توقيت المختبر.
        </p>
      )}
    </div>
  );
}

/** قائمة نصوص قابلة للإضافة والحذف وإعادة الترتيب. */
function ChipList({
  items,
  setItems,
  disabled,
  placeholder,
  defaults,
}: {
  items: string[];
  setItems: (v: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  defaults: string[];
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v) return;
    // التكرار يُنتج خيارين متطابقين في القوائم المنسدلة بلا فائدة.
    if (items.some((i) => i.trim() === v)) {
      setDraft("");
      return;
    }
    setItems([...items, v]);
    setDraft("");
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  }

  return (
    <>
      {!disabled && (
        <div className="row" style={{ marginBottom: 10 }}>
          <input
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <button className="btn" onClick={add}>
            إضافة
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty">
          لا توجد عناصر.
          {!disabled && (
            <div style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={() => setItems(defaults)}>
                استعادة القائمة الافتراضية
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <tbody>
              {items.map((it, i) => (
                <tr key={`${it}-${i}`}>
                  <td>{it}</td>
                  <td className="nowrap" style={{ width: 1 }}>
                    {!disabled && (
                      <div className="row">
                        <button
                          className="btn sm ghost"
                          onClick={() => move(i, -1)}
                          disabled={i === 0}
                          aria-label="أعلى"
                        >
                          ↑
                        </button>
                        <button
                          className="btn sm ghost"
                          onClick={() => move(i, 1)}
                          disabled={i === items.length - 1}
                          aria-label="أسفل"
                        >
                          ↓
                        </button>
                        <button
                          className="btn sm danger"
                          onClick={() => setItems(items.filter((_, k) => k !== i))}
                        >
                          حذف
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
    </>
  );
}
