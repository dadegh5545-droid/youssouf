"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { ROLE_LABEL, useSession } from "@/lib/amplify";

const TABS = [
  { href: "/", label: "لوحة اليوم" },
  { href: "/orders", label: "قائمة العمل" },
  { href: "/patients", label: "المرضى" },
  { href: "/orders/new", label: "طلب جديد" },
  { href: "/catalog", label: "كتالوج الفحوصات" },
];

export default function Nav() {
  const pathname = usePathname() || "/";
  const { signOut } = useAuthenticator((ctx) => [ctx.user]);
  const session = useSession();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav className="nav no-print">
      <div className="nav-inner">
        <Link href="/" className="brand">
          <span className="brand-mark">🧪</span>
          <span>مختبر النور الطبي</span>
        </Link>

        {TABS.map((t) => (
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
          <button className="btn sm ghost" onClick={signOut}>
            خروج
          </button>
        </div>
      </div>
    </nav>
  );
}
