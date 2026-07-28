import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../data/resource";

/* تهيئة يدوية: النسخة المثبّتة من `@aws-amplify/backend` (1.5.1) لا تصدّر
   `./function/runtime`، ومن ثمّ لا يصل مخطّط النماذج إلى الدالة فلا يعمل
   `client.models`. لذلك نكتب استعلامات GraphQL صراحةً — وهي أوضح هنا على
   أي حال: ثلاثة استعلامات معروفة بحقول محدّدة لا أكثر.
   المتغيّرات تحقنها Amplify بحكم `allow.resource(...).to(["query"])`،
   وبيانات الاعتماد من دور تنفيذ Lambda. */
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

const ORDER_FIELDS = `
  id orderNo status patientId createdAt collectedAt approvedAt approvedBy
  referringDoctor reportRevision amendedAt amendedBy amendReason cancelReason
`;

const ITEM_FIELDS = `
  id testCode testNameAr department resultType unit valueNumeric valueText
  flag comment refLow refHigh refText sortOrder
`;

const ORDER_BY_NO = /* GraphQL */ `
  query ByNo($orderNo: String!) {
    listOrdersByOrderNo(orderNo: $orderNo, limit: 1) {
      items { ${ORDER_FIELDS} }
    }
  }
`;

const PATIENT_BY_ID = /* GraphQL */ `
  query GetPatient($id: ID!) {
    getPatient(id: $id) { id mrn fullName sex birthDate phone }
  }
`;

const ITEMS_BY_ORDER = /* GraphQL */ `
  query ByOrder($orderId: ID!, $nextToken: String) {
    listOrderItemsByOrder(orderId: $orderId, limit: 200, nextToken: $nextToken) {
      items { ${ITEM_FIELDS} }
      nextToken
    }
  }
`;

type Order = Record<string, unknown> & {
  id: string;
  orderNo: string;
  status: string;
  patientId: string;
  createdAt: string;
};
type Patient = { id: string; mrn?: string; fullName?: string; sex?: string; birthDate?: string; phone?: string };
type Item = Record<string, unknown> & { sortOrder?: number };

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  // استعلامات مكتوبة يدويًا، فأنواع المتغيّرات المولّدة لا تنطبق عليها.
  const res = (await client.graphql({ query, variables } as never)) as {
    data: T;
    errors?: { message: string }[];
  };
  if (res.errors?.length) throw new Error(res.errors[0].message);
  return res.data;
}

/** حالة واحدة لعدم الوجود ولعدم التطابق: التفريق يكشف الأرقام الموجودة. */
const NOT_FOUND = JSON.stringify({ status: "NOT_FOUND" });

const normalize = (v?: string | null) => (v ?? "").replace(/[\s-]/g, "").toLowerCase();

export const handler: Schema["getMyReport"]["functionHandler"] = async (event) => {
  const orderNo = (event.arguments.orderNo ?? "").trim();
  const verifyId = normalize(event.arguments.verifyId);
  if (!orderNo || !verifyId) return NOT_FOUND;

  const found = await gql<{ listOrdersByOrderNo: { items: Order[] } }>(ORDER_BY_NO, {
    orderNo,
  });
  const order = found.listOrdersByOrderNo?.items?.[0];
  if (!order) return NOT_FOUND;

  const { getPatient: patient } = await gql<{ getPatient: Patient | null }>(
    PATIENT_BY_ID,
    { id: order.patientId }
  );

  // الرقم الثاني: رقم الملف أو الجوال. عدم التطابق = عدم وجود.
  const matches =
    !!patient &&
    (normalize(patient.mrn) === verifyId || normalize(patient.phone) === verifyId);
  if (!patient || !matches) return NOT_FOUND;

  // تقرير غير معتمد لا يُسلَّم: قد يتغيّر بمراجعة مسؤول الجودة. نُرجع
  // الحالة وحدها ليعرف المريض أين وصل طلبه.
  if (order.status !== "APPROVED" && order.status !== "DELIVERED") {
    return JSON.stringify({
      status: "PENDING",
      orderStatus: order.status,
      createdAt: order.createdAt,
    });
  }

  const items: Item[] = [];
  let nextToken: string | null = null;
  do {
    const page: { listOrderItemsByOrder: { items: Item[]; nextToken: string | null } } =
      await gql(ITEMS_BY_ORDER, { orderId: order.id, nextToken });
    items.push(...(page.listOrderItemsByOrder?.items ?? []));
    nextToken = page.listOrderItemsByOrder?.nextToken ?? null;
  } while (nextToken);

  return JSON.stringify({
    status: "OK",
    order,
    // بيانات المريض تقتصر على ما يُطبع في ترويسة التقرير — لا هاتف ولا
    // عنوان ولا هوية وطنية ولا ملاحظات سريرية داخلية.
    patient: {
      id: patient.id,
      mrn: patient.mrn,
      fullName: patient.fullName,
      sex: patient.sex,
      birthDate: patient.birthDate,
    },
    items: items.sort((a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100)),
  });
};
