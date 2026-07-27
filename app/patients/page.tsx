"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { audit, client, useSession } from "@/lib/amplify";
import type { Schema } from "@/amplify/data/resource";
import { SEX_LABEL, ageLabel, fmtDate, newMrn } from "@/lib/lab";

type Patient = Schema["Patient"]["type"];

const EMPTY = {
  fullName: "",
  sex: "MALE" as "MALE" | "FEMALE",
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
  const [form, setForm] = useState({ ...EMPTY });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  async function load() {
    const res = await client.models.Patient.list({ limit: 1000 });
    setPatients(res.data ?? []);
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

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fullName.trim()) return;
    setSaving(true);
    setMsg("");
    try {
      const mrn = newMrn();
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
          actor: session.email,
          summary: `تسجيل مريض ${data.fullName} (${mrn})`,
        });
      }
      setForm({ ...EMPTY });
      setOpen(false);
      setMsg(`تم تسجيل المريض برقم ملف ${mrn}`);
      await load();
    } catch (err) {
      setMsg(`تعذّر الحفظ: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
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
          <button className="btn primary" onClick={() => setOpen((v) => !v)}>
            {open ? "إلغاء" : "+ مريض جديد"}
          </button>
        )}
      </div>

      {msg && <div className="alert">{msg}</div>}

      {open && canManage && (
        <form className="card" style={{ marginBottom: 20 }} onSubmit={save}>
          <div className="card-head">
            <h2>تسجيل مريض جديد</h2>
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
              {saving ? "جارٍ الحفظ…" : "حفظ المريض"}
            </button>
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
                      <Link href={`/orders/new?patient=${p.id}`} className="btn sm">
                        طلب فحص
                      </Link>
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
