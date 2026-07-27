"use client";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { fetchAuthSession, fetchUserAttributes } from "aws-amplify/auth";
import { useEffect, useState } from "react";
import outputs from "@/amplify_outputs.json";
import type { Schema } from "@/amplify/data/resource";

Amplify.configure(outputs, { ssr: true });

export const client = generateClient<Schema>({ authMode: "userPool" });

export type Role = "admin" | "quality" | "tech" | "reception" | "doctor";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "مدير المختبر",
  quality: "مسؤول الجودة",
  tech: "فني مختبر",
  reception: "استقبال",
  doctor: "طبيب",
};

export type Session = {
  loading: boolean;
  email: string;
  name: string;
  roles: Role[];
  /** صلاحية تنفيذ إجراء معيّن */
  can: (action: Action) => boolean;
};

export type Action =
  | "managePatients"
  | "createOrder"
  | "collectSample"
  | "enterResults"
  | "approveResults"
  | "amendApproved"
  | "manageCatalog"
  | "viewFinance";

const MATRIX: Record<Action, Role[]> = {
  managePatients: ["admin", "reception"],
  createOrder: ["admin", "reception"],
  collectSample: ["admin", "reception", "tech"],
  enterResults: ["admin", "tech", "quality"],
  approveResults: ["admin", "quality"],
  amendApproved: ["admin", "quality"],
  manageCatalog: ["admin"],
  viewFinance: ["admin", "reception"],
};

/**
 * جلسة المستخدم الحالية مع أدواره من Cognito.
 * ملاحظة أمنية: هذا للتحكم في الواجهة فقط — التطبيق الفعلي للصلاحيات
 * يتم في قواعد authorization داخل amplify/data/resource.ts.
 */
export function useSession(): Session {
  const [state, setState] = useState<Omit<Session, "can">>({
    loading: true,
    email: "",
    name: "",
    roles: [],
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const session = await fetchAuthSession();
        const payload = session.tokens?.accessToken?.payload as
          | Record<string, unknown>
          | undefined;
        const groups = (payload?.["cognito:groups"] as string[] | undefined) ?? [];
        let email = "";
        let name = "";
        try {
          const attrs = await fetchUserAttributes();
          email = attrs.email ?? "";
          name = attrs.name ?? attrs.email ?? "";
        } catch {
          /* المستخدم قد لا يملك صلاحية قراءة السمات */
        }
        if (!alive) return;
        setState({
          loading: false,
          email,
          name,
          roles: groups.filter((g): g is Role => g in ROLE_LABEL),
        });
      } catch {
        if (alive) setState((s) => ({ ...s, loading: false }));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return {
    ...state,
    can: (action) => {
      // مستخدم بلا مجموعة (أول تسجيل) يُعامل كاستقبال حتى يعيّنه المدير.
      const roles = state.roles.length ? state.roles : (["reception"] as Role[]);
      return roles.some((r) => MATRIX[action].includes(r));
    },
  };
}

/** كتابة سطر في سجل التدقيق — لا يُفشل العملية الأصلية إذا تعذّر. */
export async function audit(entry: {
  entity: string;
  entityId: string;
  action: string;
  actor: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
}) {
  try {
    await client.models.AuditLog.create({
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      actor: entry.actor || "unknown",
      summary: entry.summary,
      before: entry.before ? JSON.stringify(entry.before) : undefined,
      after: entry.after ? JSON.stringify(entry.after) : undefined,
    });
  } catch (e) {
    console.warn("audit log failed", e);
  }
}
