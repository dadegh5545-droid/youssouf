"use client";

import { useEffect, useRef } from "react";

/**
 * قراءة باركود الأنبوب بماسح ضوئي.
 *
 * الماسحات الشائعة في المختبرات تعمل كـ«إسفين لوحة مفاتيح» (keyboard
 * wedge): لا تحتاج تعريفًا ولا إذن متصفّح، بل تطبع أحرف الرمز في الحقل
 * الذي عليه التركيز ثم ترسل Enter غالبًا. لذلك لا كاميرا هنا ولا مكتبة
 * رؤية حاسوبية — الالتقاط من أحداث لوحة المفاتيح.
 *
 * التمييز بين مسح وكتابة بشرية بالسرعة: الماسح يرسل الأحرف في أقل من
 * ٤٥ مللي‌ثانية بين الحرف والذي يليه، وأسرع كاتب لا يقارب ذلك. وكل حرف
 * خارج أبجدية Code 39 يُلغي الدفعة، فجملة عربية أو ضغطة مفاتيح متفرّقة
 * لا تُقرأ رقم طلب.
 *
 * ⚠️ الالتقاط العام معطَّل حين يكون التركيز داخل حقل كتابة: شاشة إدخال
 * النتائج مليئة بحقول أرقام، والتقاط ما يُكتب فيها كان سيغيّر نتيجة
 * مريض بصمت. من أراد المسح وحقلٌ مركَّز فليمسح داخل صندوق المسح نفسه.
 */

/** أقصى فاصل زمني (مللي‌ثانية) بين حرفين في دفعة مسح واحدة. */
export const SCAN_MAX_GAP_MS = 45;

/** صمت بعده تُعدّ الدفعة منتهية — لماسح غير مضبوط على Enter. */
export const SCAN_IDLE_MS = 120;

/** أقصر رمز يُقبل. أقصر من ذلك يغلب أن يكون ضغطة عابرة لا مسحًا. */
export const SCAN_MIN_LENGTH = 4;

/** أبجدية Code 39 وحدها — وهي ما يستطيع الملصق حمله أصلًا. */
const SCAN_CHAR = /^[A-Za-z0-9\-. $/+%*]$/;

export function isScanChar(ch: string): boolean {
  return ch.length === 1 && SCAN_CHAR.test(ch);
}

/**
 * توحيد شكل الرمز الممسوح: حرفا الحدّ (`*`) اللذان تُدرجهما بعض
 * الماسحات يُحذفان، والفراغات تُزال، والأحرف تُرفع. النتيجة تُقارن
 * برقم الطلب كما هو محفوظ.
 */
export function normalizeScan(raw: string): string {
  return raw.replace(/\*/g, "").replace(/\s+/g, "").trim().toUpperCase();
}

/** هل الرمز الممسوح يخصّ هذا الطلب؟ */
export function scanMatchesOrder(scanned: string, orderNo?: string | null): boolean {
  const a = normalizeScan(scanned);
  const b = normalizeScan(orderNo ?? "");
  return a.length > 0 && a === b;
}

/**
 * مخزن الدفعة الحالية — منفصل عن الـ DOM كي يكون قابلًا للاختبار.
 *
 * `push` تُغذّى بحرف وطابعه الزمني، و`flush` تُنهي الدفعة وترجع الرمز
 * إن بلغ الحدّ الأدنى. تجاوز `SCAN_MAX_GAP_MS` بين حرفين يبدأ دفعة
 * جديدة: كتابة بشرية بطيئة لا تتراكم حتى تصير طول رمز.
 */
export class ScanBuffer {
  private buf = "";
  private last = -Infinity;
  /* دفعة مسمومة: ورد فيها حرف خارج الأبجدية، فلا يُقرأ منها شيء حتى
     تبدأ دفعة جديدة. تصفير المخزن وحده لا يكفي — الأحرف التي تلي الحرف
     الفاسد كانت تتراكم وحدها وتُقرأ رمزًا قصيرًا صحيح الشكل («0729-000042»
     من مسح مشوَّش)، وهو أخطر من ألا يُقرأ شيء: رقم طلب آخر موجود فعلًا. */
  private poisoned = false;

  push(ch: string, now: number): void {
    if (now - this.last > SCAN_MAX_GAP_MS) {
      this.buf = "";
      this.poisoned = false;
    }
    this.last = now;
    if (this.poisoned) return;
    if (!isScanChar(ch)) {
      this.poisoned = true;
      this.buf = "";
      return;
    }
    this.buf += ch;
  }

  /** هل بلغت الدفعة طول رمز مقبول؟ (لفحصها قبل ابتلاع مفتاح Enter) */
  get ready(): boolean {
    return normalizeScan(this.buf).length >= SCAN_MIN_LENGTH;
  }

  flush(): string | null {
    const code = normalizeScan(this.buf);
    this.buf = "";
    this.last = -Infinity;
    this.poisoned = false;
    return code.length >= SCAN_MIN_LENGTH ? code : null;
  }
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}

/**
 * يستدعي `onScan` عند اكتمال مسح خارج حقول الكتابة.
 *
 * @param enabled لإيقافه في الصفحات التي لا معنى للمسح فيها.
 */
export function useBarcodeScanner(
  onScan: (code: string) => void,
  enabled = true
): void {
  const cb = useRef(onScan);

  useEffect(() => {
    cb.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const buf = new ScanBuffer();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const emit = () => {
      const code = buf.flush();
      if (code) cb.current(code);
    };

    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;

      if (e.key === "Enter") {
        clearTimeout(timer);
        // نبتلع Enter إن كان خاتمة مسح فعلي فقط، وإلا تعطّلنا أزرار
        // الصفحة التي تُفعَّل بـ Enter.
        if (buf.ready) e.preventDefault();
        emit();
        return;
      }
      if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;

      buf.push(e.key, Date.now());
      clearTimeout(timer);
      // ماسح غير مضبوط على Enter: الصمت هو نهاية الدفعة.
      timer = setTimeout(emit, SCAN_IDLE_MS);
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(timer);
    };
  }, [enabled]);
}
