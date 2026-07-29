"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  addPayment,
  audit,
  client,
  listAll,
  nextOrderNo,
  useSession,
} from "@/lib/amplify";
import type { Schema } from "@/amplify/data/resource";
import {
  DEPARTMENT_LABEL,
  PAYMENT_METHOD_LABEL,
  SEX_LABEL,
  ageInYears,
  ageLabel,
  fmtMoney,
  localDay,
  orderNet,
  pickRange,
  rangeLabel,
} from "@/lib/lab";

type Patient = Schema["Patient"]["type"];
type LabTest = Schema["LabTest"]["type"];

export default function Page() {
  return (
    <Suspense fallback={<p className="muted">جارٍ التحميل…</p>}>
      <NewOrder />
    </Suspense>
  );
}

function NewOrder() {
  const router = useRouter();
  const params = useSearchParams();
  const session = useSession();

  const [patients, setPatients] = useState<Patient[]>([]);
  const [tests, setTests] = useState<LabTest[]>([]);
  const [patientId, setPatientId] = useState(params.get("patient") ?? "");
  const [patientQ, setPatientQ] = useState("");
  const [testQ, setTestQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]); // أكواد الفحوصات المختارة
  const [doctor, setDoctor] = useState("");
  const [notes, setNotes] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [paid, setPaid] = useState(0);
  const [method, setMethod] = useState("CASH");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const [p, t] = await Promise.all([
        listAll<Patient>((nextToken) =>
          client.models.Patient.list({ limit: 500, nextToken })
        ),
        listAll<LabTest>((nextToken) =>
          client.models.LabTest.list({ limit: 500, nextToken })
        ),
      ]);
      setPatients(p);
      setTests(t.filter((x) => x.active !== false));
    })().catch((e) => setMsg(String(e)));
  }, []);

  const patient = patients.find((p) => p.id === patientId) ?? null;
  const byCode = useMemo(() => {
    const m = new Map<string, LabTest>();
    tests.forEach((t) => m.set(t.code, t));
    return m;
  }, [tests]);

  /** الفحوصات المعروضة للاختيار: نستبعد مكوّنات الباقات (تُطلب عبر الباقة). */
  const selectable = useMemo(() => {
    const componentCodes = new Set<string>();
    tests.forEach((t) => (t.panelOf ?? []).forEach((c) => c && componentCodes.add(c)));
    const term = testQ.trim().toLowerCase();
    return tests
      .filter((t) => !componentCodes.has(t.code))
      .filter((t) =>
        term
          ? t.nameAr?.toLowerCase().includes(term) ||
            t.nameEn?.toLowerCase().includes(term) ||
            t.code?.toLowerCase().includes(term)
          : true
      )
      .sort((a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100));
  }, [tests, testQ]);

  const filteredPatients = useMemo(() => {
    const term = patientQ.trim();
    if (!term) return patients.slice(0, 8);
    return patients
      .filter(
        (p) =>
          p.fullName?.includes(term) || p.mrn?.includes(term) || p.phone?.includes(term)
      )
      .slice(0, 8);
  }, [patients, patientQ]);

  const total = picked.reduce((s, code) => s + (byCode.get(code)?.price ?? 0), 0);
  const net = orderNet(total, discount);

  function toggle(code: string) {
    setPicked((cur) =>
      cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]
    );
  }

  /** يفكّ الباقات إلى فحوصاتها المكوّنة، مع الحفاظ على الترتيب وبلا تكرار. */
  function expand(codes: string[]): LabTest[] {
    const out: LabTest[] = [];
    const seen = new Set<string>();
    for (const code of codes) {
      const t = byCode.get(code);
      if (!t) continue;
      const children = (t.panelOf ?? []).filter(Boolean) as string[];
      const targets = children.length ? children : [code];
      for (const c of targets) {
        const ct = byCode.get(c);
        if (ct && !seen.has(c)) {
          seen.add(c);
          out.push(ct);
        }
      }
    }
    return out;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!patient || picked.length === 0) return;
    setSaving(true);
    setMsg("");
    try {
      // رقم الطلب يُطبع على الباركود الملصق على الأنبوب: يحجزه عدّاد
      // تسلسلي ذرّي في الخادم، ويُتحقّق من عدم وجوده قبل الإنشاء.
      const orderNo = await nextOrderNo();
      const { data: order, errors } = await client.models.Order.create({
        orderNo,
        patientId: patient.id,
        status: "REGISTERED",
        priority: urgent ? "URGENT" : "ROUTINE",
        referringDoctor: doctor || undefined,
        clinicalNotes: notes || undefined,
        totalPrice: total,
        discount,
        // المقبوض يأتي من سطر `Payment` أدناه لا من هنا: النسخة المخبَّأة
        // تُحتسب من السجل، وكتابتها هنا تسبق السطر فتتناقض معه لو تعذّر.
        paidAmount: 0,
        day: localDay(),
      });
      if (errors?.length) throw new Error(errors[0].message);
      if (!order) throw new Error("لم يُنشأ الطلب");

      const age = ageInYears(patient.birthDate);
      const items = expand(picked);

      try {
        for (const t of items) {
          // المدى المرجعي يُجمَّد الآن حسب جنس المريض وعمره،
          // حتى لا يتغيّر التقرير إذا عُدّل الكتالوج لاحقًا.
          const r = pickRange(t.ranges ?? [], patient.sex as "MALE" | "FEMALE", age);
          const { errors: itemErrors } = await client.models.OrderItem.create({
            orderId: order.id,
            testCode: t.code,
            testNameAr: t.nameAr,
            department: t.department,
            resultType: t.resultType,
            unit: t.unit,
            sampleType: t.sampleType,
            tubeType: t.tubeType,
            options: t.options,
            price: t.price ?? 0,
            refLow: r?.low ?? undefined,
            refHigh: r?.high ?? undefined,
            refText: rangeLabel(r?.low, r?.high, r?.text),
            criticalLow: t.criticalLow,
            criticalHigh: t.criticalHigh,
            sortOrder: t.sortOrder,
          });
          if (itemErrors?.length) throw new Error(itemErrors[0].message);
        }
      } catch (itemErr) {
        // لا معاملات (transactions) هنا: الطلب أُنشئ لكن فحوصاته ناقصة.
        // نلغيه بدل تركه في قائمة العمل بفحوصات جزئية تُعتمد وتُطبع.
        await client.models.Order.update({
          id: order.id,
          status: "CANCELLED",
          cancelledAt: new Date().toISOString(),
          cancelledBy: session.actor,
          cancelReason: `فشل إنشاء فحوصات الطلب: ${(itemErr as Error).message}`,
        });
        throw itemErr;
      }

      await audit({
        entity: "Order",
        entityId: order.id,
        action: "ORDER_CREATED",
        actor: session.actor,
        summary: `طلب ${orderNo} — ${items.length} فحص للمريض ${patient.fullName}`,
      });

      /* الدفعة الأولى سطر في السجل كأي دفعة أخرى. فشلها لا يُلغي الطلب —
         الطلب صحيح والفحوصات قائمة، الناقص تسجيل مال. ننقل الموظف إلى
         صفحة الطلب برسالة صريحة وزرّ التسجيل أمامه، فلا يضيع القبض
         ولا يُلغى عمل صحيح. */
      if (paid > 0) {
        try {
          await addPayment({
            orderId: order.id,
            orderNo,
            amount: Math.min(paid, net),
            method,
            actor: session.actor,
          });
          await audit({
            entity: "Order",
            entityId: order.id,
            action: "PAYMENT_RECORDED",
            actor: session.actor,
            summary: `دفعة أولى ${fmtMoney(Math.min(paid, net))} (${
              PAYMENT_METHOD_LABEL[method] ?? method
            }) على الطلب ${orderNo}`,
          });
        } catch (payErr) {
          router.push(
            `/orders/view?id=${order.id}&payfail=${encodeURIComponent(
              (payErr as Error).message
            )}`
          );
          return;
        }
      }

      router.push(`/orders/view?id=${order.id}`);
    } catch (err) {
      setMsg(`تعذّر إنشاء الطلب: ${(err as Error).message}`);
      setSaving(false);
    }
  }

  const expandedCount = expand(picked).length;

  return (
    <form onSubmit={submit}>
      <div className="page-head">
        <div>
          <h1>طلب فحص جديد</h1>
          <p>اختر المريض ثم الفحوصات المطلوبة — يُولَّد رقم طلب فريد للعيّنة.</p>
        </div>
      </div>

      {msg && <div className="alert danger">{msg}</div>}
      {tests.length === 0 && (
        <div className="alert warn">
          كتالوج الفحوصات فارغ — حمّله أولًا من صفحة «كتالوج الفحوصات».
        </div>
      )}

      <div className="grid cols-2">
        {/* ── المريض ── */}
        <div className="card">
          <div className="card-head">
            <h2>١. المريض</h2>
          </div>
          {patient ? (
            <div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                {patient.fullName}
              </div>
              <div className="muted small" style={{ marginTop: 4 }}>
                <span className="mono">{patient.mrn}</span> ·{" "}
                {SEX_LABEL[patient.sex ?? ""]} · {ageLabel(patient.birthDate)}
                {patient.phone ? ` · ${patient.phone}` : ""}
              </div>
              {patient.notes && (
                <div className="alert warn" style={{ marginTop: 10 }}>
                  ملاحظة طبية: {patient.notes}
                </div>
              )}
              <button
                type="button"
                className="btn sm"
                style={{ marginTop: 12 }}
                onClick={() => setPatientId("")}
              >
                تغيير المريض
              </button>
            </div>
          ) : (
            <>
              <input
                placeholder="ابحث بالاسم أو رقم الملف أو الجوال…"
                value={patientQ}
                onChange={(e) => setPatientQ(e.target.value)}
              />
              <div style={{ marginTop: 10 }}>
                {filteredPatients.length === 0 ? (
                  <p className="muted small">
                    لا نتائج — سجّل المريض أولًا من صفحة «المرضى».
                  </p>
                ) : (
                  filteredPatients.map((p) => (
                    <div
                      key={p.id}
                      className="test-row"
                      onClick={() => setPatientId(p.id)}
                    >
                      <span className="code">{p.mrn}</span>
                      <span style={{ fontWeight: 600 }}>{p.fullName}</span>
                      <span className="muted small">
                        {SEX_LABEL[p.sex ?? ""]} · {ageLabel(p.birthDate)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          <div className="grid cols-2" style={{ marginTop: 18 }}>
            <div className="field">
              <label>الطبيب المُحوِّل</label>
              <input value={doctor} onChange={(e) => setDoctor(e.target.value)} />
            </div>
            <div className="field">
              <label>الأولوية</label>
              <select
                value={urgent ? "URGENT" : "ROUTINE"}
                onChange={(e) => setUrgent(e.target.value === "URGENT")}
              >
                <option value="ROUTINE">عادي</option>
                <option value="URGENT">مستعجل</option>
              </select>
            </div>
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>الشكوى / التشخيص المبدئي</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        {/* ── الفحوصات ── */}
        <div className="card">
          <div className="card-head">
            <h2>٢. الفحوصات</h2>
            <span className="badge info">
              {picked.length} مختار · {expandedCount} بارامتر
            </span>
          </div>
          <input
            placeholder="ابحث عن فحص…"
            value={testQ}
            onChange={(e) => setTestQ(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          <div className="test-picker">
            {selectable.map((t) => (
              <div
                key={t.id}
                className={`test-row${picked.includes(t.code) ? " picked" : ""}`}
                onClick={() => toggle(t.code)}
              >
                <input
                  type="checkbox"
                  readOnly
                  checked={picked.includes(t.code)}
                  tabIndex={-1}
                />
                <span className="code">{t.code}</span>
                <span style={{ fontWeight: 600 }}>{t.nameAr}</span>
                <span className="muted small">
                  {DEPARTMENT_LABEL[t.department ?? ""]}
                </span>
                {/* الأنبوب تعليمة لفنّي السحب: يراها قبل تسجيل الطلب. */}
                {t.tubeType && (
                  <span className="muted small nowrap">🧪 {t.tubeType}</span>
                )}
                <span className="spacer" />
                <span className="muted small nowrap">{fmtMoney(t.price)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── الفاتورة ── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h2>٣. الفاتورة</h2>
        </div>
        <div className="grid cols-4">
          <div className="field">
            <label>الإجمالي</label>
            <input readOnly value={fmtMoney(total)} />
          </div>
          <div className="field">
            <label>الخصم</label>
            <input
              type="number"
              min={0}
              value={discount}
              onChange={(e) => setDiscount(Number(e.target.value) || 0)}
            />
          </div>
          <div className="field">
            <label>الصافي</label>
            <input readOnly value={fmtMoney(net)} />
          </div>
          <div className="field">
            <label>المدفوع</label>
            <div className="row">
              <input
                type="number"
                min={0}
                max={net}
                value={paid}
                onChange={(e) => setPaid(Number(e.target.value) || 0)}
              />
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                aria-label="طريقة الدفع"
                disabled={paid <= 0}
              >
                {Object.entries(PAYMENT_METHOD_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            {paid > net && (
              <div className="hint">
                أكبر من الصافي — سيُسجَّل {fmtMoney(net)} فقط.
              </div>
            )}
          </div>
        </div>
        <div className="row" style={{ marginTop: 18 }}>
          <button
            className="btn primary"
            disabled={!patient || picked.length === 0 || saving}
          >
            {saving ? "جارٍ الإنشاء…" : "إنشاء الطلب وطباعة الملصق"}
          </button>
          {net > paid && (
            <span className="badge warn">متبقٍ للسداد: {fmtMoney(net - paid)}</span>
          )}
        </div>
      </div>
    </form>
  );
}
