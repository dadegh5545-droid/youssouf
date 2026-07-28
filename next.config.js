/** @type {import('next').NextConfig} */

/**
 * تصدير ثابت (SPA).
 *
 * كل صفحات التطبيق "use client" وتجلب بياناتها من AppSync في المتصفح،
 * فلا حاجة إلى خادم Next. التصدير الثابت يجعل الاستضافة ملفات على CDN:
 * أرخص، أسرع، وبلا خادم يُصان أو يُرقَّع.
 *
 * نتيجةً لذلك لا توجد مقاطع مسار ديناميكية — الطلبات تُفتح عبر
 * `/orders/view?id=…` لأن Next لا يستطيع توليد صفحة لكل طلب وقت
 * البناء (الطلبات تُنشأ بعد النشر).
 *
 * `trailingSlash` يُخرج `orders/view/index.html` بدل `orders/view.html`،
 * وهو ما تخدمه معظم استضافات الملفات الثابتة بلا قواعد إعادة كتابة.
 */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

module.exports = nextConfig;
