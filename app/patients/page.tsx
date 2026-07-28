"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { audit, client, listAll, reserveMrn, useSession } from "@/lib/amplify";
import type { Schema } from "@/amplify/data/resource";
import { SEX_LABEL, ageLabel, fmtDate, newMrn } from "@/lib/lab";

type Patient = Schema["Patient"]["type"];

type Form = {
  fullName: string;
  sex: "MALE" | "FEMALE";
  birthDate: string;
  phone: string;
  nationalId: string;
  address: string;
  notes: string;
};

const EMPTY: Form = {
  fullName: "",
  sex: "MALE",
  birthDate: "",
  phone: "",
  nationalId: "",
  address: "",
  notes: "",
};

export default function PatientsPage() {
  const session = useSession();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState<Form>({ ...EMPTY });
  const [open, setOpen] = useState(false);
  /** null = تسجيل جديد، وإلا معرّف المريض قيد التعديل */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  async function load() {
    setPatients(
      await listAll<Patient>((nextToken) =>
        client.models.Patient.list({ limit: 500, nextToken })
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

  const filtered = useMemo(() => {
    const term = q.trim();
    const list = term
      ? patients.filter(
          (p) =>
            p.fullName?.includes(term) ||
            p.mrn?.includes(term) ||
            p.phone?.includes(term) ||
            p.nationalId?.includes(term)
        )
      : patients;
    return [...list].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }, [patients, q]);

  function startCreate() {
    setEditingId(null);
    setForm({ ...EMPTY });
    setOpen(true);
    setMsg("");
  }

  function startEdit(p: Patient) {
    setEditingId(p.id);
    setForm({
      fullName: p.fullName ?? "",
      sex: (p.sex as "MALE" | "FEMALE") ?? "MALE",
      birthDate: p.birthDate ?? "",
      phone: p.phone ?? "",
      nationalId: p.nationalId ?? "",
      address: p.address ?? "",
      notes: p.notes ?? "",
    });
    setOpen(true);
    setMsg("");
  }

  function closeForm() {
    setOpen(false);
    setEditingId(null);
    setForm({ ...EMPTY });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fullName.trim()) return;
    setSaving(true);
    setMsg("");
    try {
      if (editingId) {
        await saveEdit(editingId);
      } else {
        await saveNew();
      }
      closeForm();
      await load();
    } catch (err) {
      setMsg(`تعذّر الحفظ: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveNew() {
    // رقم الملف هوية المريض في النظام؛ تكراره يخلط ملفّين.
    const mrn = await reserveMrn(newMrn);
    const { data, errors } = await client.models.Patient.create({
      mrn,
      fullName: form.fullName.trim(),
      sex: form.sex,
      birthDate: form.birthDate || undefined,
      phone: form.phone || undefined,
      nationalId: form.nationalId || undefined,
      address: form.address || undefined,
      notes: form.notes || undefined,
    });
    if (errors?.length) throw new Error(errors[0].message);
    if (data) {
      await audit({
        entity: "Patient",
        entityId: data.id,
        action: "PATIENT_CREATED",
        actor: session.actor,
        summary: `تسجيل مريض ${data.fullName} (${mrn})`,
      });
    }
    setMsg(`تم تسجيل المريض برقم ملف ${mrn}`);
  }

  /**
   * تصحيح بيانات مريض. رقم الملف (mrn) لا يُعدَّل أبدًا — الطلبات
   * والتقارير الصادرة تشير إليه، وتغييره يقطع أثر السجلات.
   * كل تغيير يُحفظ في سجل التدقيق بقيمته قبل وبعد.
   */
  async function saveEdit(id: string) {
    const before = patients.find((p) => p.id === id);
    if (!before) throw new Error("المريض غير موجود");

    const next = {
      fullName: form.fullName.trim(),
      sex: form.sex,
      birthDate: form.birthDate || null,
      phone: form.phone || null,
      nationalId: form.nationalId || null,
      address: form.address || null,
      notes: form.notes || null,
    };

    const changedKeys = (Object.keys(next) as (keyof typeof next)[]).filter(
      (k) => (before[k] ?? null) !== next[k]
    );
    if (changedKeys.length === 0) {
      setMsg("لا توجد تغييرات لحفظها.");
      return;
    }

    // تغيير الجنس أو تاريخ الميلاد يغيّر المدى المرجعي المطبَّق على
    // الطلبات الجديدة — لكن الطلبات القديمة تحتفظ بمداها المجمَّد.
    const critical = changedKeys.filter((k) => k === "sex" || k === "birthDate");
    if (critical.length > 0) {
      const ok = window.confirm(
        "تعديل الجنس أو تاريخ الميلاد يغيّر المديات المرجعية للطلبات الجديدة.\n" +
          "التقارير الصادرة سابقًا تبقى بمدياتها الأصلية.\n\nهل تريد المتابعة؟"
      );
      if (!ok) throw new Error("أُلغي التعديل");
    }

    const { errors } = await client.models.Patient.update({ id, ...next });
    if (errors?.length) throw new Error(errors[0].message);

    await audit({
      entity: "Patient",
      entityId: id,
      action: "PATIENT_UPDATED",
      actor: session.actor,
      summary: `تعديل ملف ${before.mrn}: ${changedKeys.join("، ")}`,
      before: Object.fromEntries(changedKeys.map((k) => [k, before[k] ?? null])),
      after: Object.fromEntries(changedKeys.map((k) => [k, next[k]])),
    });
    setMsg(`حُفظ تعديل ملف ${before.mrn} (${changedKeys.length} حقل).`);
  }

  const canManage = session.can("managePatients");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>المرضى</h1>
          <p>{patients.length} ملف مسجّل</p>
        </div>
        {canManage && (
          <button
            className="btn primary"
            onClick={() => (open ? closeForm() : startCreate())}
          >
            {open ? "إلغاء" : "+ مريض جديد"}
          </button>
        )}
      </div>

      {msg && <div className="alert">{msg}</div>}

      {open && canManage && (
        <form className="card" style={{ marginBottom: 20 }} onSubmit={save}>
          <div className="card-head">
            <h2>
              {editingId ? "تعديل بيانات المريض" : "تسجيل مريض جديد"}
            </h2>
            {editingId && (
              <span className="muted small mono">
                {patients.find((p) => p.id === editingId)?.mrn}
              </span>
            )}
          </div>
          <div className="grid cols-3">
            <div className="field">
              <label>الاسم الكامل *</label>
              <input
                required
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                placeholder="مثال: أحمد محمد العلي"
              />
            </div>
            <div className="field">
              <label>الجنس *</label>
              <select
                value={form.sex}
                onChange={(e) =>
                  setForm({ ...form, sex: e.target.value as "MALE" | "FEMALE" })
                }
              >
                <option value="MALE">ذكر</option>
                <option value="FEMALE">أنثى</option>
              </select>
            </div>
            <div className="field">
              <label>تاريخ الميلاد</label>
              <input
                type="date"
                value={form.birthDate}
                onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
              />
              <span className="hint">يُستخدم لاختيار المدى المرجعي الصحيح</span>
            </div>
            <div className="field">
              <label>رقم الجوال</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="05xxxxxxxx"
              />
            </div>
            <div className="field">
              <label>رقم الهوية</label>
              <input
                value={form.nationalId}
                onChange={(e) => setForm({ ...form, nationalId: e.target.value })}
              />
            </div>
            <div className="field">
              <label>العنوان</label>
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
          </div>
          <div className="field" style={{ marginTop: 14 }}>
            <label>ملاحظات طبية</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="حساسية، أدوية مزمنة، حمل…"
            />
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn primary" disabled={saving}>
              {saving
                ? "جارٍ الحفظ…"
                : editingId
                ? "حفظ التعديل"
                : "حفظ المريض"}
            </button>
            <button type="button" className="btn ghost" onClick={closeForm}>
              إلغاء
            </button>
            {editingId && (
              <span className="muted small">
                رقم الملف لا يُعدَّل — التقارير الصادرة تشير إليه.
              </span>
            )}
          </div>
        </form>
      )}

      <div className="card">
        <div className="card-head">
          <input
            style={{ maxWidth: 340 }}
            placeholder="بحث بالاسم أو رقم الملف أو الجوال…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="muted small">{filtered.length} نتيجة</span>
        </div>

        {loading ? (
          <p className="muted">جارٍ التحميل…</p>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <span className="icon">👤</span>
            لا يوجد مرضى مطابقون.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>رقم الملف</th>
                  <th>الاسم</th>
                  <th>الجنس</th>
                  <th>العمر</th>
                  <th>الجوال</th>
                  <th>تاريخ التسجيل</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td className="mono nowrap">{p.mrn}</td>
                    <td>{p.fullName}</td>
                    <td>{SEX_LABEL[p.sex ?? ""] ?? "—"}</td>
                    <td className="nowrap">{ageLabel(p.birthDate)}</td>
                    <td className="mono">{p.phone || "—"}</td>
                    <td className="small nowrap">{fmtDate(p.createdAt)}</td>
                    <td className="nowrap">
                      <div className="row">
                        {canManage && (
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => startEdit(p)}
                          >
                            تعديل
                          </button>
                        )}
                        <Link href={`/orders/new?patient=${p.id}`} className="btn sm">
                          طلب فحص
                        </Link>
                      </div>
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
