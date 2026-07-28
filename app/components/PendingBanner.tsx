"use client";

import { useSession } from "@/lib/amplify";

/**
 * مستخدم سجّل دخوله لكن المدير لم يُسنده إلى أي مجموعة بعد.
 *
 * قبل هذا كان يُعامَل كـ«استقبال» في الواجهة فقط، فيرى أزرارًا يرفضها
 * الخادم برسالة GraphQL غامضة. الآن تُخفى الأزرار وتُشرح الحالة.
 */
export default function PendingBanner() {
  const session = useSession();
  if (!session.pending) return null;

  return (
    <div className="alert warn no-print" style={{ marginBottom: 16 }}>
      حسابك <span className="mono">{session.email}</span> مسجَّل لكن لم تُسنَد له
      صلاحية بعد، لذلك لا تظهر لك بيانات ولا أزرار.
      <div className="small" style={{ fontWeight: 400, marginTop: 6 }}>
        اطلب من مدير المختبر إضافتك إلى إحدى المجموعات (
        <span className="mono">admin</span> ·{" "}
        <span className="mono">quality</span> · <span className="mono">tech</span> ·{" "}
        <span className="mono">reception</span> ·{" "}
        <span className="mono">doctor</span>) ثم سجّل خروجًا ودخولًا ليُحدَّث
        الرمز المميّز.
      </div>
    </div>
  );
}
