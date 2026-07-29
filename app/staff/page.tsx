"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ROLE_LABEL,
  audit,
  client,
  parseJson,
  useSession,
  type Role,
} from "@/lib/amplify";
import { fmtDateTime } from "@/lib/lab";

/**
 * إدارة الموظفين وأدوارهم — لمدير المختبر.
 *
 * الأدوار مجموعات في Cognito لا صفوف في جدول، فلا تُقرأ ولا تُعدَّل من
 * المتصفّح مباشرة: كل ما هنا يمرّ بدالة `manage-staff` التي يحصر المخطط
 * استدعاءها في مجموعة `admin`.
 *
 * قبل هذه الصفحة كان تفعيل حساب موظف جديد يتطلّب سطر أوامر AWS، أي أن
 * المختبر يعجز عن توظيف أحد بلا مطوّر.
 */

const ROLES: Role[] = ["admin", "quality", "tech", "reception", "doctor"];

const ROLE_HINT: Record<Role, string> = {
  admin: "كل الصلاحيات، وإدارة الكتالوج والموظفين",
  quality: "مراجعة النتائج واعتمادها وتصحيح تقرير معتمد",
  tech: "إدخال نتائج الفحوصات",
  reception: "تسجيل المرضى والطلبات والفواتير",
  doctor: "اطّلاع على النتائج فقط",
};

type Staff = {
  username: string;
  email: string;
  name: string;
  enabled: boolean;
  status: string;
  createdAt?: string;
  groups: Role[];
};

type Reply = { status: string; staff?: Staff[]; message?: string };

/** حالة الحساب في Cognito بلغة مفهومة لمدير المختبر. */
const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: "مفعَّل",
  UNCONFIRMED: "لم يؤكّد بريده",
  FORCE_CHANGE_PASSWORD: "بانتظار تغيير كلمة المرور",
  RESET_REQUIRED: "بانتظار إعادة تعيين الكلمة",
};

export default function StaffPage() {
  const session = useSession();
  const canManage = session.can("manageStaff");

  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await client.queries.listStaff();
      if (res.errors?.length) throw new Error(res.errors[0].message);
      const reply = parseJson<Reply>(res.data);
      if (!reply || reply.status !== "OK") {
        throw new Error(reply?.message || "ردّ غير مفهوم من الخادم.");
      }
      setStaff(reply.staff ?? []);
    } catch (e) {
      setErr(`تعذّر جلب قائمة الموظفين: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session.loading && canManage) void load();
    else if (!session.loading) setLoading(false);
  }, [session.loading, canManage, load]);

  async function run(
    action: string,
    user: Staff,
    group?: Role,
    summary?: string
  ) {
    setBusy(`${user.username}:${action}:${group ?? ""}`);
    setMsg("");
    setErr("");
    try {
      const res = await client.mutations.manageStaff({
        action,
        username: user.username,
        group,
      });
      if (res.errors?.length) throw new Error(res.errors[0].message);
      const reply = parseJson<Reply>(res.data);
      if (!reply || reply.status !== "OK") {
        throw new Error(reply?.message || "تعذّر تنفيذ الإجراء.");
      }
      if (reply.staff) setStaff(reply.staff);

      /* تغيير الصلاحيات حدث يستحق التدقيق بقدر تغيير نتيجة: من منح
         صلاحية الاعتماد لمن، ومتى. */
      await audit({
        entity: "Staff",
        entityId: user.username,
        action: `STAFF_${action}`,
        actor: session.actor,
        summary: summary ?? `${action} — ${user.email}`,
        after: { email: user.email, group },
      });

      setMsg(reply.message || summary || "نُفّذ الإجراء.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  function toggleRole(user: Staff, role: Role) {
    const has = user.groups.includes(role);
    return run(
      has ? "REMOVE_GROUP" : "ADD_GROUP",
      user,
      role,
      has
        ? `سُحبت صلاحية «${ROLE_LABEL[role]}» من ${user.email}`
        : `مُنحت صلاحية «${ROLE_LABEL[role]}» لـ${user.email}`
    );
  }

  if (session.loading || loading) return <p className="muted">جارٍ التحميل…</p>;

  if (!canManage) {
    return (
      <div className="alert warn">
        إدارة الموظفين متاحة لمدير المختبر (مجموعة{" "}
        <span className="mono">admin</span>) فقط.
      </div>
    );
  }

  const pending = staff.filter((s) => s.groups.length === 0 && s.enabled);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>الموظفون والصلاحيات</h1>
          <p>
            من يستطيع الدخول إلى النظام، وماذا يستطيع أن يفعل. الموظف يُنشئ
            حسابه بنفسه من صفحة الدخول، ثم تمنحه أنت صلاحيته هنا.
          </p>
        </div>
        <button className="btn" onClick={() => void load()}>
          تحديث
        </button>
      </div>

      {msg && <div className="alert ok">{msg}</div>}
      {err && <div className="alert danger">{err}</div>}

      {pending.length > 0 && (
        <div className="alert warn">
          {pending.length === 1
            ? "حساب واحد بانتظار صلاحية"
            : `${pending.length} حسابات بانتظار صلاحية`}{" "}
          — لا يرى صاحبه شيئًا حتى تمنحه دورًا:{" "}
          <span className="mono">{pending.map((p) => p.email).join("، ")}</span>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>القائمة</h2>
          <span className="muted small">{staff.length} حساب</span>
        </div>

        {staff.length === 0 ? (
          <div className="empty">
            لا حسابات بعد. أنشئ حسابك من صفحة الدخول ثم أضفه لمجموعة{" "}
            <span className="mono">admin</span>.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>الموظف</th>
                  <th>الحالة</th>
                  <th>الصلاحيات</th>
                  <th className="nowrap">الحساب</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((u) => {
                  const isSelf = u.email === session.email;
                  return (
                    <tr key={u.username}>
                      <td>
                        <div>
                          {u.name}
                          {isSelf && (
                            <span
                              className="badge info"
                              style={{ marginInlineStart: 8 }}
                            >
                              أنت
                            </span>
                          )}
                        </div>
                        <div className="muted small mono">{u.email}</div>
                        {u.createdAt && (
                          <div className="muted small">
                            سُجّل {fmtDateTime(u.createdAt)}
                          </div>
                        )}
                      </td>

                      <td className="nowrap">
                        {!u.enabled ? (
                          <span className="badge critical">معطَّل</span>
                        ) : u.groups.length === 0 ? (
                          <span className="badge warn">بانتظار صلاحية</span>
                        ) : (
                          <span className="badge ok">
                            {STATUS_LABEL[u.status] ?? u.status}
                          </span>
                        )}
                      </td>

                      <td>
                        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                          {ROLES.map((role) => {
                            const has = u.groups.includes(role);
                            const key = `${u.username}:${has ? "REMOVE_GROUP" : "ADD_GROUP"}:${role}`;
                            /* المدير لا يسحب صفة الإدارة عن نفسه: الدالة
                               ترفضها على الخادم، ونخفي الزر هنا كي لا
                               يضغط ثم يقرأ رسالة رفض. */
                            const locked = isSelf && role === "admin" && has;
                            return (
                              <button
                                key={role}
                                className={`btn sm ${has ? "primary" : "ghost"}`}
                                title={
                                  locked
                                    ? "لا يمكنك إزالة صفة المدير عن نفسك"
                                    : ROLE_HINT[role]
                                }
                                disabled={!!busy || !u.enabled || locked}
                                onClick={() => void toggleRole(u, role)}
                              >
                                {busy === key ? "…" : ROLE_LABEL[role]}
                              </button>
                            );
                          })}
                        </div>
                        {u.groups.length === 0 && u.enabled && (
                          <div className="hint">
                            بلا صلاحية: يسجّل الدخول ولا يرى أي صفحة.
                          </div>
                        )}
                      </td>

                      <td className="nowrap">
                        <div className="row">
                          <button
                            className="btn sm ghost"
                            disabled={!!busy}
                            onClick={() =>
                              void run(
                                "RESET_PASSWORD",
                                u,
                                undefined,
                                `أُرسل رمز إعادة تعيين الكلمة إلى ${u.email}`
                              )
                            }
                          >
                            إعادة تعيين الكلمة
                          </button>
                          {u.enabled ? (
                            <button
                              className="btn sm danger"
                              disabled={!!busy || isSelf}
                              title={isSelf ? "لا يمكنك تعطيل حسابك" : ""}
                              onClick={() => {
                                if (
                                  confirm(
                                    `تعطيل حساب ${u.email}؟ لن يستطيع الدخول، وتبقى سجلاته كما هي.`
                                  )
                                )
                                  void run(
                                    "DISABLE",
                                    u,
                                    undefined,
                                    `عُطِّل حساب ${u.email}`
                                  );
                              }}
                            >
                              تعطيل
                            </button>
                          ) : (
                            <button
                              className="btn sm"
                              disabled={!!busy}
                              onClick={() =>
                                void run(
                                  "ENABLE",
                                  u,
                                  undefined,
                                  `فُعِّل حساب ${u.email}`
                                )
                              }
                            >
                              تفعيل
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>ماذا يعني كل دور</h2>
        </div>
        <div className="table-wrap">
          <table>
            <tbody>
              {ROLES.map((r) => (
                <tr key={r}>
                  <td className="nowrap">
                    <strong>{ROLE_LABEL[r]}</strong>
                    <div className="muted small mono">{r}</div>
                  </td>
                  <td>{ROLE_HINT[r]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hint">
          مبدأ أربع أعين: من أدخل النتيجة لا يعتمدها بنفسه. امنح «فني مختبر»
          و«مسؤول الجودة» لشخصين مختلفين — منحهما لشخص واحد يبطل المراجعة.
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>كيف يُضاف موظف جديد</h2>
        </div>
        <ol style={{ margin: 0, paddingInlineStart: 20, lineHeight: 2 }}>
          <li>
            يفتح الموظف <span className="mono">/login</span> ويُنشئ حسابًا
            ببريده، ويؤكّد البريد بالرمز الذي يصله.
          </li>
          <li>يظهر اسمه هنا ضمن «بانتظار صلاحية».</li>
          <li>تضغط أنت على الدور المناسب له.</li>
          <li>
            يسجّل خروجًا ودخولًا ليُحدَّث رمزه فتظهر له الصفحات — الصلاحيات
            تُقرأ من الرمز لا من الخادم عند كل نقرة.
          </li>
        </ol>
      </div>
    </>
  );
}
