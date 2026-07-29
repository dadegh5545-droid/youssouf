"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { client } from "@/lib/amplify";
import { DEFAULT_CURRENCY, setCurrency } from "@/lib/lab";

/**
 * إعدادات المختبر: العملة وقوائم أنواع العيّنات والأنابيب.
 *
 * تُحفظ في سجل واحد (`LabConfig` بمفتاح `MAIN`) يعدّله مدير المختبر من
 * صفحة الإعدادات، وتُقرأ مرة واحدة عند فتح التطبيق. القوائم في قاعدة
 * البيانات لا في الكود: إضافة نوع أنبوب جديد لا تستلزم نشر إصدار.
 */

export const MAIN_KEY = "MAIN";

export const DEFAULT_SAMPLE_TYPES = [
  "دم وريدي",
  "دم شعري",
  "مصل",
  "بلازما",
  "بول",
  "براز",
  "مسحة",
  "سائل نخاعي",
  "سائل منوي",
  "بلغم",
];

export const DEFAULT_TUBE_TYPES = [
  "أنبوب أحمر (بلا مانع تخثر)",
  "أنبوب أصفر (جل فاصل)",
  "أنبوب بنفسجي (EDTA)",
  "أنبوب أزرق (سترات الصوديوم)",
  "أنبوب رمادي (فلورايد)",
  "أنبوب أخضر (هيبارين)",
  "حاوية بول معقّمة",
  "حاوية براز",
  "وسط نقل المسحات",
];

/** عملات شائعة — اختصار على المدير، والحقل يقبل أي رمز آخر. */
export const CURRENCY_PRESETS: { code: string; symbol: string; label: string }[] = [
  { code: "SAR", symbol: "ر.س", label: "ريال سعودي" },
  { code: "YER", symbol: "ر.ي", label: "ريال يمني" },
  { code: "AED", symbol: "د.إ", label: "درهم إماراتي" },
  { code: "EGP", symbol: "ج.م", label: "جنيه مصري" },
  { code: "USD", symbol: "$", label: "دولار أمريكي" },
  { code: "EUR", symbol: "€", label: "يورو" },
];

export type LabConfigFields = {
  labName: string;
  /* ترويسة التقرير المطبوع — بيانات المختبر الحقيقية لا قيم في الكود.
     الفارغ منها لا يُطبع: سطر خالٍ أسلم من رقم ترخيص مُختلَق. */
  labNameEn: string;
  licenseNo: string;
  contact: string;
  currency: string;
  currencyCode: string;
  sampleTypes: string[];
  tubeTypes: string[];
};

export type LabConfigValue = LabConfigFields & {
  loading: boolean;
  error: string;
  /** يحفظ التعديلات وينشئ السجل المفرد إن لم يكن موجودًا */
  save: (patch: Partial<LabConfigFields>) => Promise<void>;
  reload: () => Promise<void>;
};

const FALLBACK: LabConfigFields = {
  labName: "مختبر النور الطبي",
  // فارغة عمدًا: لا اسم إنجليزي ولا ترخيص ولا عنوان يُخترع لمختبر
  // لم يُدخل بياناته. ما يُطبع على وثيقة طبية يجب أن يكون صحيحًا أو غائبًا.
  labNameEn: "",
  licenseNo: "",
  contact: "",
  currency: DEFAULT_CURRENCY,
  currencyCode: "SAR",
  sampleTypes: DEFAULT_SAMPLE_TYPES,
  tubeTypes: DEFAULT_TUBE_TYPES,
};

const Ctx = createContext<LabConfigValue>({
  ...FALLBACK,
  loading: true,
  error: "",
  save: async () => {},
  reload: async () => {},
});

export function useLabConfig(): LabConfigValue {
  return useContext(Ctx);
}

export function LabConfigProvider({ children }: { children: React.ReactNode }) {
  const [fields, setFields] = useState<LabConfigFields>(FALLBACK);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const apply = useCallback((f: LabConfigFields) => {
    setFields(f);
    // `fmtMoney` تقرأ الرمز من وحدة `lab`، فتُحدَّث هنا مرة واحدة.
    setCurrency(f.currency);
  }, []);

  const reload = useCallback(async () => {
    try {
      const { data, errors } = await client.models.LabConfig.listLabConfigByKey(
        { key: MAIN_KEY },
        { limit: 1 }
      );
      if (errors?.length) throw new Error(errors[0].message);
      const row = data?.[0];
      if (row) {
        setRecordId(row.id);
        apply({
          labName: row.labName || FALLBACK.labName,
          labNameEn: row.labNameEn ?? "",
          licenseNo: row.licenseNo ?? "",
          contact: row.contact ?? "",
          currency: row.currency || FALLBACK.currency,
          currencyCode: row.currencyCode || FALLBACK.currencyCode,
          sampleTypes: clean(row.sampleTypes) ?? FALLBACK.sampleTypes,
          tubeTypes: clean(row.tubeTypes) ?? FALLBACK.tubeTypes,
        });
      }
    } catch (e) {
      // لا إعدادات = القيم الافتراضية. التطبيق يعمل بلا سجل إعدادات.
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (patch: Partial<LabConfigFields>) => {
      const next = { ...fields, ...patch };
      const payload = {
        key: MAIN_KEY,
        labName: next.labName,
        labNameEn: next.labNameEn,
        licenseNo: next.licenseNo,
        contact: next.contact,
        currency: next.currency,
        currencyCode: next.currencyCode,
        sampleTypes: next.sampleTypes,
        tubeTypes: next.tubeTypes,
      };

      const res = recordId
        ? await client.models.LabConfig.update({ id: recordId, ...payload })
        : await client.models.LabConfig.create(payload);
      if (res.errors?.length) throw new Error(res.errors[0].message);
      if (res.data?.id) setRecordId(res.data.id);
      apply(next);
    },
    [fields, recordId, apply]
  );

  return (
    <Ctx.Provider value={{ ...fields, loading, error, save, reload }}>
      {children}
    </Ctx.Provider>
  );
}

/** يُسقط القيم الفارغة/الفاسدة ويعيد `null` للقائمة الفارغة. */
function clean(list?: readonly (string | null)[] | null): string[] | null {
  const out = (list ?? []).filter((v): v is string => !!v && v.trim().length > 0);
  return out.length ? out : null;
}
