"use client";

import { encodeCode39 } from "@/lib/barcode";

/**
 * باركود Code 39 مرسوم SVG.
 *
 * SVG لا صورة نقطية: الملصقات تُطبع على طابعات حرارية بدقة عالية، وصورة
 * نقطية مكبَّرة تُنتج حوافّ متعرّجة تربك الماسح. والرقم يُطبع تحته دائمًا
 * — إن رفض الماسح القراءة (ملصق مبلَّل أو مثنيّ) يبقى الفنّي قادرًا على
 * إدخاله بيده بدل أن يخمّن العيّنة.
 */
export default function Barcode({
  value,
  height = 46,
  unit = 1.6,
  showText = true,
  className,
}: {
  value: string;
  /** ارتفاع الخطوط بالبكسل */
  height?: number;
  /** عرض العنصر الضيّق بالبكسل — أقل من 1.2 يصعب على الماسحات الرخيصة */
  unit?: number;
  showText?: boolean;
  className?: string;
}) {
  if (!value) return null;

  const { bars, width, text } = encodeCode39(value);

  /* هامش هادئ (quiet zone): المعيار يوجب فراغًا أبيض بعرض ١٠ عناصر على
     الأقل قبل الباركود وبعده. بلا هذا الفراغ يقرأ الماسح ما جاوره من
     حبر — أو لا يقرأ شيئًا. */
  const quiet = 10;
  const totalUnits = width + quiet * 2;

  return (
    <div className={className} style={{ display: "inline-block", textAlign: "center" }}>
      <svg
        width={totalUnits * unit}
        height={height}
        viewBox={`0 0 ${totalUnits} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`باركود ${text}`}
        style={{ display: "block", background: "#fff" }}
      >
        {bars.map((b, i) => (
          <rect
            key={i}
            x={b.x + quiet}
            y={0}
            width={b.width}
            height={height}
            fill="#000"
          />
        ))}
      </svg>
      {showText && (
        <div
          className="mono"
          style={{
            fontSize: "0.72rem",
            letterSpacing: 1,
            marginTop: 2,
            color: "#000",
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
