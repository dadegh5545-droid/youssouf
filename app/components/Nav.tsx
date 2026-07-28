"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "aws-amplify/auth";
import { ROLE_LABEL, useSession } from "@/lib/amplify";
import { useLabConfig } from "@/lib/config";

const TABS = [
  { href: "/", label: "لوحة اليوم" },
  { href: "/orders", label: "قائمة العمل" },
  { href: "/patients", label: "المرضى" },
  { href: "/orders/new", label: "طلب جديد" },
  { href: "/catalog", label: "كتالوج الفحوصات" },
  { href: "/settings", label: "الإعدادات" },
];

export default function Nav() {
  const pathname = usePathname() || "/";
  const session = useSession();
  const { labName } = useLabConfig();

  /* إعادة تحميل كاملة بعد الخروج: الأدوار والوضع (زائر/مسجَّل) تُقرأ مرة
     واحدة عند تركيب المكوّنات، فبلا تحميل تبقى الواجهة على حالة قديمة. */
  async function handleSignOut() {
    await signOut();
    window.location.href = "/";
  }

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav className="nav no-print">
      <div className="nav-inner">
        <Link href="/" className="brand">
          <span className="brand-mark">🧪</span>
          <span>{labName}</span>
        </Link>

        {/* الزائر لا يرى تبويبات الموظفين — صفحته الوحيدة هي تقريره. */}
        {(session.guest ? [] : TABS).map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`tab${isActive(t.href) ? " active" : ""}`}
          >
            {t.label}
          </Link>
        ))}

        <span className="spacer" />

        <div className="nav-user">
          {session.guest ? (
            <>
              <span>أهلًا بك 👋</span>
              <Link href="/" className="btn sm ghost">
                تقريري
              </Link>
              <Link href="/login" className="btn sm ghost">
                تسجيل الدخول
              </Link>
            </>
          ) : (
            <>
              <span>
                {session.name || session.email}
                {session.roles.length > 0 ? (
                  <span className="badge info" style={{ marginInlineStart: 8 }}>
                    {session.roles.map((r) => ROLE_LABEL[r]).join("، ")}
                  </span>
                ) : (
                  session.pending && (
                    <span className="badge warn" style={{ marginInlineStart: 8 }}>
                      بانتظار صلاحية
                    </span>
                  )
                )}
              </span>
              <button className="btn sm ghost" onClick={handleSignOut}>
                خروج
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
