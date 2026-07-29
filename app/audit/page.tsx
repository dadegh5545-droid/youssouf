"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { client, listAll, useSession } from "@/lib/amplify";
import { fmtDateTime, localDay } from "@/lib/lab";
import { ACTION_LABEL, NOTABLE } from "@/lib/audit";
import type { Schema } from "@/amplify/data/resource";

type Log = Schema["AuditLog"]["type"];

/**
 * سجل التدقيق — من فعل ماذا ومتى.
 *
 * كان يُكتب ولا يُقرأ: النظام يسجّل كل إدخال واعتماد وتصحيح بأمانة، ولا
 * شاشة تعرضه. سجل تدقيق لا يفتحه المدير لا يصلح دليلًا عند نزاع على
 * نتيجة، وهو أول ما تطلبه أي مراجعة جودة.
 *
 * القراءة بيوم واحد لا بمسح الجدول: هذا الجدول أسرع الجداول نموًّا — سطر
 * لكل نتيجة تُدخل — ومسحه يبطؤ شهرًا بعد شهر حتى تعجز الصفحة عن الفتح.
 */

const ENTITY_LABEL: Record<string, string> = {
  Order: "طلب",
  OrderItem: "فحص",
  Patient: "مريض",
  LabTest: "كتالوج",
  Staff: "موظف",
};

export default function AuditPage() {
  const session = useSession();
  const canView = session.can("viewAudit");

  const [day, setDay] = useState(() => localDay());
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [onlyNotable, setOnlyNotable] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setErr("");
    try {
      const rows = await listAll<Log>((nextToken) =>
        client.models.AuditLog.listAuditByDay(
          { day: d },
          { limit: 300, sortDirection: "DESC", nextToken }
        )
      );
      setLogs(rows);
    } catch (e) {
      setErr(`تعذّر جلب السجل: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session.loading && canView) void load(day);
    else if (!session.loading) setLoading(false);
  }, [session.loading, canView, day, load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return logs
      .filter((l) => !onlyNotable || NOTABLE.has(l.action))
      .filter((l) => {
        if (!needle) return true;
        return [l.actor, l.summary, l.action, l.entityId]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle));
      })
      .sort((a, b) => String(b.at ?? b.createdAt).localeCompare(String(a.at ?? a.createdAt)));
  }, [logs, q, onlyNotable]);

  const actors = useMemo(
    () => Array.from(new Set(logs.map((l) => l.actor))).length,
    [logs]
  );
  const notableCount = useMemo(
    () => logs.filter((l) => NOTABLE.has(l.action)).length,
    [logs]
  );

  if (session.loading) return <p className="muted">جارٍ التحميل…</p>;

  if (!canView) {
    return (
      <div className="alert warn">
        سجل التدقيق متاح لمدير المختبر ومسؤول الجودة فقط.
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>سجل التدقيق</h1>
          <p>
            كل إدخال واعتماد وتصحيح وتغيير سعر، بمن فعله ووقته وقيمته قبل
            وبعد. لا يُعدَّل ولا يُحذف — ولا حتى من المدير.
          </p>
        </div>
        <div className="row">
          <input
            type="date"
            value={day}
            max={localDay()}
            onChange={(e) => setDay(e.target.value)}
            aria-label="اليوم"
          />
          <button className="btn" onClick={() => void load(day)}>
            تحديث
          </button>
        </div>
      </div>

      {err && <div className="alert danger">{err}</div>}

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="label">أحداث اليوم</div>
          <div className="value">{logs.length}</div>
          <div className="sub">{day}</div>
        </div>
        <div className="stat">
          <div className="label">من فعلها</div>
          <div className="value">{actors}</div>
          <div className="sub">مستخدمًا مختلفًا</div>
        </div>
        <div className={`stat${notableCount > 0 ? " warn-accent" : ""}`}>
          <div className="label">تستحق المراجعة</div>
          <div className="value">{notableCount}</div>
          <div className="sub">تصحيح · إلغاء · سعر · صلاحية</div>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <input
          placeholder="ابحث باسم المستخدم أو رقم الطلب أو نص الحدث…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 280 }}
        />
        <button
          className={`btn ${onlyNotable ? "primary" : "ghost"}`}
          onClick={() => setOnlyNotable((v) => !v)}
        >
          ما يستحق المراجعة فقط
        </button>
      </div>

      {loading ? (
        <p className="muted">جارٍ التحميل…</p>
      ) : shown.length === 0 ? (
        <div className="empty">
          <span className="icon">🗒️</span>
          لا أحداث في هذا اليوم.
          <div className="muted small" style={{ marginTop: 8 }}>
            السجلات المكتوبة قبل إضافة هذه الشاشة لا تحمل مفتاح اليوم، فلا
            تظهر هنا. ما يُكتب من الآن يظهر.
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 130 }}>الوقت</th>
                <th>الحدث</th>
                <th>التفاصيل</th>
                <th style={{ width: 180 }}>من</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => {
                const notable = NOTABLE.has(l.action);
                const hasDiff = !!(l.before || l.after);
                return (
                  <tr key={l.id} className={notable ? "critical-row" : ""}>
                    <td className="mono small nowrap">
                      {fmtDateTime(l.at ?? l.createdAt).split("، ")[1] ??
                        fmtDateTime(l.at ?? l.createdAt)}
                    </td>
                    <td className="nowrap">
                      <span className={`badge ${notable ? "warn" : "muted"}`}>
                        {ACTION_LABEL[l.action] ?? l.action}
                      </span>
                      <div className="muted small">
                        {ENTITY_LABEL[l.entity] ?? l.entity}
                      </div>
                    </td>
                    <td>
                      {l.summary || "—"}
                      {hasDiff && (
                        <>
                          {" "}
                          <button
                            className="btn sm ghost"
                            onClick={() => setOpen(open === l.id ? null : l.id)}
                          >
                            {open === l.id ? "إخفاء" : "قبل / بعد"}
                          </button>
                          {open === l.id && (
                            <div className="grid cols-2" style={{ marginTop: 8 }}>
                              <div>
                                <div className="muted small">قبل</div>
                                <pre className="mono small diff-box">
                                  {pretty(l.before)}
                                </pre>
                              </div>
                              <div>
                                <div className="muted small">بعد</div>
                                <pre className="mono small diff-box">
                                  {pretty(l.after)}
                                </pre>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="small">{l.actor}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="hint" style={{ marginTop: 12 }}>
        عُرض {shown.length} من {logs.length} حدثًا في {day}.
      </div>
    </>
  );
}

/** قيمة السجل قد تصل نصًا أو نصًا داخل نص — تُعرض مقروءة أو كما هي. */
function pretty(raw: unknown): string {
  if (raw == null) return "—";
  let v: unknown = raw;
  for (let i = 0; i < 2 && typeof v === "string"; i++) {
    try {
      v = JSON.parse(v);
    } catch {
      return String(v);
    }
  }
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
