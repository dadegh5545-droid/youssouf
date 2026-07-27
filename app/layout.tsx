import type { Metadata } from "next";
import "./app.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "مختبر النور الطبي — نظام إدارة المختبر",
  description: "نظام إدارة مختبر طبي: تسجيل المرضى، الطلبات، النتائج والتقارير",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
