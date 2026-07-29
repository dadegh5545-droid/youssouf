"use client";

import { useState } from "react";
import { normalizeScan, useBarcodeScanner } from "@/lib/scanner";

/**
 * صندوق مسح الباركود.
 *
 * يجمع طريقتَي الإدخال في مخرج واحد: الالتقاط العام (مسح والتركيز خارج
 * أي حقل) والكتابة اليدوية داخل الصندوق. الثانية ليست ترفًا — الملصق
 * يتلطّخ أو ينثني على الأنبوب فيعجز الماسح عنه، والفنّي يقرأ الرقم
 * بعينه ويكتبه؛ بلا هذا المخرج يتعطّل العمل لعطب ملصق واحد.
 */
export default function ScanBox({
  onScan,
  placeholder = "امسح باركود الأنبوب أو اكتب رقم الطلب…",
  disabled,
}: {
  onScan: (code: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");

  useBarcodeScanner((code) => {
    if (!disabled) onScan(code);
  }, !disabled);

  function submit() {
    const code = normalizeScan(value);
    if (!code) return;
    setValue("");
    onScan(code);
  }

  return (
    <div className="row">
      <span aria-hidden style={{ fontSize: "1.2rem" }}>
        📷
      </span>
      <input
        className="mono"
        style={{ maxWidth: 260 }}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="باركود الأنبوب"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // الماسح يُنهي الرمز بـ Enter، وهو هنا داخل حقل فيلزم منعه
          // من إرسال النموذج المحيط.
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button type="button" className="btn" onClick={submit} disabled={disabled}>
        تحقّق
      </button>
    </div>
  );
}
