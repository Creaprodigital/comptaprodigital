import { adminRoute } from "@/server/http/api";
import { listSettings, updateSetting } from "@/server/modules/admin/settings";
import { settingUpdateSchema } from "@/lib/schemas/admin";

export const GET = adminRoute({}, async () => listSettings());

export const PUT = adminRoute<Record<string, never>, typeof settingUpdateSchema>({ body: settingUpdateSchema }, async ({ auth, body }) => {
  await updateSetting(body.key, body.value, auth.user.id);
  return listSettings();
});
