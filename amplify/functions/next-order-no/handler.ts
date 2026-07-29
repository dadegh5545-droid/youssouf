import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../data/resource";

/* تهيئة يدوية بنفس سبب دالة `get-my-report`: النسخة المثبّتة من
   `@aws-amplify/backend` (1.5.1) لا تصدّر `./function/runtime`، فلا يصل
   مخطّط النماذج إلى الدالة ولا يعمل `client.models`. الاستعلامات مكتوبة
   يدويًا أدناه. */
Amplify.configure(
  {
    API: {
      GraphQL: {
        endpoint: process.env.AMPLIFY_DATA_GRAPHQL_ENDPOINT!,
        region: process.env.AWS_REGION!,
        defaultAuthMode: "iam",
      },
    },
  },
  {
    Auth: {
      credentialsProvider: {
        getCredentialsAndIdentityId: async () => ({
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            sessionToken: process.env.AWS_SESSION_TOKEN!,
          },
        }),
        clearCredentialsAndIdentityId: () => {
          /* بيانات الاعتماد من الدور، لا شيء يُمسح */
        },
      },
    },
  }
);

const client = generateClient();

const GET_COUNTER = /* GraphQL */ `
  query GetCounter($key: String!) {
    getCounter(key: $key) {
      key
      value
    }
  }
`;

const CREATE_COUNTER = /* GraphQL */ `
  mutation CreateCounter($key: String!, $value: Int!) {
    createCounter(input: { key: $key, value: $value }) {
      key
      value
    }
  }
`;

/* شرط `value = current` هو جوهر المسألة: DynamoDB يقيّمه ويكتب في عملية
   ذرّية واحدة، فلو سبقنا أحدٌ إلى القيمة نفسها فشل الشرط ولم يُكتب شيء.
   بلا الشرط تكون هذه قراءة ثم كتابة عاديّة — أي المشكلة التي نحلّها. */
const BUMP_COUNTER = /* GraphQL */ `
  mutation BumpCounter($key: String!, $next: Int!, $current: Int!) {
    updateCounter(
      input: { key: $key, value: $next }
      condition: { value: { eq: $current } }
    ) {
      key
      value
    }
  }
`;

type Counter = { key: string; value: number } | null;

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  // استعلامات مكتوبة يدويًا، فأنواع المتغيّرات المولّدة لا تنطبق عليها.
  const res = (await client.graphql({ query, variables } as never)) as {
    data: T;
    errors?: { message: string }[];
  };
  if (res.errors?.length) throw new Error(res.errors[0].message);
  return res.data;
}

/** أقصى عدد محاولات مقارنة-وتبديل قبل الاستسلام. */
const MAX_ATTEMPTS = 12;

/** ٦ خانات كي يبقى طول رقم الطلب كما كان — عرض الباركود والملصق ثابت. */
const SEQ_DIGITS = 6;

/**
 * اليوم يصل من العميل لا يُحسب هنا: Lambda تعمل بتوقيت UTC، والمختبر
 * يعمل بتوقيته المحلي. لو حُسب هنا لبدأ عدّاد «اليوم» عند الثالثة صباحًا
 * بالرياض فيحمل طلبان في ليلة واحدة ختمَي يومين مختلفين.
 */
const STAMP = /^\d{6}$/;

export const handler: Schema["nextOrderNo"]["functionHandler"] = async (event) => {
  const stamp = (event.arguments.stamp ?? "").trim();
  if (!STAMP.test(stamp)) {
    throw new Error("ختم تاريخ غير صالح — يجب أن يكون ٦ أرقام (YYMMDD).");
  }

  const key = `ORDER-${stamp}`;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { getCounter: current } = await gql<{ getCounter: Counter }>(GET_COUNTER, {
      key,
    });

    if (!current) {
      // أوّل طلب في هذا اليوم. `createCounter` يكتب بشرط عدم وجود المفتاح،
      // فلو سبقنا أحد فشل الإنشاء وأعدنا المحاولة قارئين ما كتبه.
      try {
        const created = await gql<{ createCounter: Counter }>(CREATE_COUNTER, {
          key,
          value: 1,
        });
        if (created.createCounter) return done(stamp, created.createCounter.value);
      } catch {
        continue;
      }
      continue;
    }

    const next = current.value + 1;
    try {
      const bumped = await gql<{ updateCounter: Counter }>(BUMP_COUNTER, {
        key,
        next,
        current: current.value,
      });
      if (bumped.updateCounter) return done(stamp, bumped.updateCounter.value);
    } catch {
      // فشل الشرط = سبقنا غيرنا. نعيد القراءة ونحاول بالقيمة الجديدة.
      continue;
    }
  }

  throw new Error(`تعذّر حجز رقم طلب بعد ${MAX_ATTEMPTS} محاولة — أعد المحاولة.`);
};

function done(stamp: string, seq: number): string {
  return JSON.stringify({
    orderNo: `LAB-${stamp}-${String(seq).padStart(SEQ_DIGITS, "0")}`,
    seq,
  });
}
