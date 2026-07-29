import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminResetUserPasswordCommand,
  type UserType,
} from "@aws-sdk/client-cognito-identity-provider";

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

/** الأدوار المعرَّفة في amplify/auth/resource.ts — لا يُقبل غيرها. */
const GROUPS = ["admin", "quality", "tech", "reception", "doctor"] as const;
type Group = (typeof GROUPS)[number];

const isGroup = (v: unknown): v is Group =>
  typeof v === "string" && (GROUPS as readonly string[]).includes(v);

type Staff = {
  username: string;
  email: string;
  name: string;
  enabled: boolean;
  status: string;
  createdAt?: string;
  groups: Group[];
};

const attr = (u: UserType, key: string) =>
  u.Attributes?.find((a) => a.Name === key)?.Value ?? "";

function toStaff(u: UserType): Staff {
  return {
    username: u.Username ?? "",
    email: attr(u, "email"),
    name: attr(u, "name") || attr(u, "email"),
    enabled: u.Enabled ?? false,
    status: u.UserStatus ?? "",
    createdAt: u.UserCreateDate?.toISOString(),
    groups: [],
  };
}

/**
 * قائمة الموظفين مع أدوارهم.
 *
 * الأدوار تُجمع بـ `ListUsersInGroup` لكل مجموعة (خمسة استدعاءات ثابتة)
 * لا بـ `AdminListGroupsForUser` لكل مستخدم — الثاني استدعاء لكل موظف،
 * فيتضاعف زمن الصفحة كلما وُظِّف أحد.
 */
async function listStaff(): Promise<Staff[]> {
  const byUsername = new Map<string, Staff>();

  // ListUsers يرجع 60 مستخدمًا كحد أقصى في الصفحة مهما كان Limit،
  // ويعيد PaginationToken للبقية. تجاهلها يعني اختفاء موظفين من القائمة.
  let token: string | undefined;
  let guard = 0;
  do {
    const page = await cognito.send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Limit: 60,
        PaginationToken: token,
      })
    );
    for (const u of page.Users ?? []) {
      const s = toStaff(u);
      if (s.username) byUsername.set(s.username, s);
    }
    token = page.PaginationToken;
  } while (token && ++guard < 100);

  for (const group of GROUPS) {
    let gToken: string | undefined;
    let gGuard = 0;
    do {
      const page = await cognito.send(
        new ListUsersInGroupCommand({
          UserPoolId: USER_POOL_ID,
          GroupName: group,
          Limit: 60,
          NextToken: gToken,
        })
      );
      for (const u of page.Users ?? []) {
        const s = u.Username ? byUsername.get(u.Username) : undefined;
        if (s) s.groups.push(group);
      }
      gToken = page.NextToken;
    } while (gToken && ++gGuard < 100);
  }

  return [...byUsername.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

type Args = {
  action?: string | null;
  username?: string | null;
  group?: string | null;
};

/** معرّف المستدعي كما يصل من رمز Cognito — لحماية المدير من قفل نفسه. */
function callerUsername(event: unknown): string {
  const identity = (event as { identity?: Record<string, unknown> }).identity;
  if (!identity) return "";
  const claims = identity.claims as Record<string, unknown> | undefined;
  return (
    (identity.username as string) ||
    (claims?.["cognito:username"] as string) ||
    (claims?.sub as string) ||
    ""
  );
}

const fail = (message: string) => JSON.stringify({ status: "ERROR", message });

export const handler = async (event: {
  arguments?: Args;
  info?: { fieldName?: string };
  identity?: unknown;
}) => {
  const args = event.arguments ?? {};
  const action = (args.action ?? "").toUpperCase();

  // الاستعلام بلا `action` = قراءة القائمة.
  if (!action || action === "LIST" || event.info?.fieldName === "listStaff") {
    return JSON.stringify({ status: "OK", staff: await listStaff() });
  }

  const username = (args.username ?? "").trim();
  if (!username) return fail("لم يُحدَّد المستخدم.");

  const caller = callerUsername(event);
  const self = caller && caller === username;

  switch (action) {
    case "ADD_GROUP":
    case "REMOVE_GROUP": {
      if (!isGroup(args.group)) return fail("دور غير معروف.");

      /* حارس القفل الذاتي: مدير يزيل «admin» عن نفسه يفقد صفحة إدارة
         المستخدمين، ولا يستطيع إعادتها إلا من سطر أوامر AWS. لو لم يبقَ
         مدير آخر لضاع النظام كله على المختبر. */
      if (self && args.group === "admin" && action === "REMOVE_GROUP") {
        return fail("لا يمكنك إزالة صفة المدير عن نفسك. اطلب ذلك من مدير آخر.");
      }

      const Command =
        action === "ADD_GROUP"
          ? AdminAddUserToGroupCommand
          : AdminRemoveUserFromGroupCommand;
      await cognito.send(
        new Command({
          UserPoolId: USER_POOL_ID,
          Username: username,
          GroupName: args.group,
        })
      );
      return JSON.stringify({ status: "OK", staff: await listStaff() });
    }

    case "DISABLE":
    case "ENABLE": {
      if (self && action === "DISABLE") {
        return fail("لا يمكنك تعطيل حسابك أنت.");
      }
      await cognito.send(
        action === "DISABLE"
          ? new AdminDisableUserCommand({ UserPoolId: USER_POOL_ID, Username: username })
          : new AdminEnableUserCommand({ UserPoolId: USER_POOL_ID, Username: username })
      );
      return JSON.stringify({ status: "OK", staff: await listStaff() });
    }

    /* إعادة التعيين ترسل رمزًا إلى بريد الموظف ولا تكشف كلمة مرور لأحد،
       فالمدير لا يستطيع انتحال شخصية موظف بحجة «نسي كلمته». */
    case "RESET_PASSWORD": {
      await cognito.send(
        new AdminResetUserPasswordCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
        })
      );
      return JSON.stringify({
        status: "OK",
        message: "أُرسل رمز إعادة التعيين إلى بريد الموظف.",
        staff: await listStaff(),
      });
    }

    default:
      return fail("إجراء غير معروف.");
  }
};
