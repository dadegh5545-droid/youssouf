/**
 * مولّد باركود Code 39.
 *
 * لماذا Code 39 لا Code 128: جدوله ٤٤ حرفًا كل حرف مستقل بذاته بلا حالات
 * ولا مجموع تحقّق إلزامي، فيمكن التحقّق من صحة الترميز بقواعد بنيوية
 * (اختبارات هذا الملف) لا بمقارنة صورة بصورة. Code 128 أضيق بنحو الثلث
 * لكن جدوله ١٠٧ أنماط، وخطأ مطبعي واحد فيه يعطي باركودًا يُمسح بنجاح
 * ويعطي رقمًا آخر — أي عيّنة تُنسب إلى مريض غير صاحبها.
 *
 * كل حرف تسعة عناصر متناوبة تبدأ بخط: خط، فراغ، خط… ثلاثة منها عريضة.
 * ويُحاط النص بحرف `*` بداية ونهاية، وهو ما تتعرّف به الماسحات على
 * أول الرمز وآخره.
 */

/** `n` ضيّق و`w` عريض، بالتناوب: خط فراغ خط فراغ خط فراغ خط فراغ خط. */
export const CODE39: Record<string, string> = {
  "0": "nnnwwnwnn",
  "1": "wnnwnnnnw",
  "2": "nnwwnnnnw",
  "3": "wnwwnnnnn",
  "4": "nnnwwnnnw",
  "5": "wnnwwnnnn",
  "6": "nnwwwnnnn",
  "7": "nnnwnnwnw",
  "8": "wnnwnnwnn",
  "9": "nnwwnnwnn",
  A: "wnnnnwnnw",
  B: "nnwnnwnnw",
  C: "wnwnnwnnn",
  D: "nnnnwwnnw",
  E: "wnnnwwnnn",
  F: "nnwnwwnnn",
  G: "nnnnnwwnw",
  H: "wnnnnwwnn",
  I: "nnwnnwwnn",
  J: "nnnnwwwnn",
  K: "wnnnnnnww",
  L: "nnwnnnnww",
  M: "wnwnnnnwn",
  N: "nnnnwnnww",
  O: "wnnnwnnwn",
  P: "nnwnwnnwn",
  Q: "nnnnnnwww",
  R: "wnnnnnwwn",
  S: "nnwnnnwwn",
  T: "nnnnwnwwn",
  U: "wwnnnnnnw",
  V: "nwwnnnnnw",
  W: "wwwnnnnnn",
  X: "nwnnwnnnw",
  Y: "wwnnwnnnn",
  Z: "nwwnwnnnn",
  "-": "nwnnnnwnw",
  ".": "wwnnnnwnn",
  " ": "nwwnnnwnn",
  $: "nwnwnwnnn",
  "/": "nwnwnnnwn",
  "+": "nwnnnwnwn",
  "%": "nnnwnwnwn",
  "*": "nwnnwnwnn",
};

/** حرف البداية والنهاية — ليس جزءًا من البيانات. */
const GUARD = "*";

/**
 * ما يقبله Code 39. الأحرف الصغيرة تُرفع، وما عداها يُستبدل بشرطة بدل
 * أن يُسقط: إسقاط حرف يغيّر الرقم بصمت، والشرطة تبقيه ظاهرًا مختلفًا.
 */
export function sanitizeCode39(text: string): string {
  return text
    .toUpperCase()
    .split("")
    .map((ch) => (ch in CODE39 && ch !== GUARD ? ch : "-"))
    .join("");
}

export type BarcodeBar = {
  /** موضع بداية الخط بوحدات العنصر الضيّق */
  x: number;
  width: number;
};

export type Barcode = {
  /** الخطوط السوداء وحدها — الفراغات تُترك بيضاء */
  bars: BarcodeBar[];
  /** العرض الكلي بوحدات العنصر الضيّق */
  width: number;
  /** النص كما رُمِّز فعلًا (بعد التنقية، بلا حرفَي الحدّ) */
  text: string;
};

/**
 * يحوّل نصًا إلى خطوط باركود.
 *
 * @param wideRatio نسبة العريض إلى الضيّق. المعيار يقبل ٢:١ حتى ٣:١،
 *   و٣ أسهل على الماسحات الرخيصة وطابعات الملصقات منخفضة الدقة.
 */
export function encodeCode39(text: string, wideRatio = 3): Barcode {
  const clean = sanitizeCode39(text);
  const chars = (GUARD + clean + GUARD).split("");

  const bars: BarcodeBar[] = [];
  let x = 0;

  for (let c = 0; c < chars.length; c++) {
    const pattern = CODE39[chars[c]];
    for (let i = 0; i < pattern.length; i++) {
      const width = pattern[i] === "w" ? wideRatio : 1;
      // العناصر تبدأ بخط وتتناوب، فالمواضع الزوجية خطوط والفردية فراغات.
      if (i % 2 === 0) bars.push({ x, width });
      x += width;
    }
    // فاصل بين الأحرف بعرض عنصر ضيّق — بلا فاصل يلتصق آخر خط بأول التالي
    // فيُقرأ الحرفان حرفًا واحدًا خاطئًا.
    if (c < chars.length - 1) x += 1;
  }

  return { bars, width: x, text: clean };
}
