import { notFound, redirect } from "next/navigation";
import { PanelShell } from "@/components/panel-shell";
import {
  UsersPermissionsModule,
  type PermissionRecord,
  type RoleRecord,
  type UserPermissionOverride,
  type UserPermissionRecord
} from "@/components/users-permissions-module";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  account_type: "staff" | "client" | null;
  is_active: boolean | null;
  created_at: string | null;
  last_seen_at: string | null;
  user_roles?: Array<{ role: RoleRecord["role"] }>;
};

type RolePermissionRow = {
  role: RoleRecord["role"];
  permission_code: string;
};

export default async function SettingsPanelPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((roleRow) => roleRow.role) ?? [];
  const isAdmin = roleNames.includes("admin_sistema");

  if (!isAdmin) {
    notFound();
  }

  const [profilesResult, appRolesResult, permissionsResult, rolePermissionsResult, overridesResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, phone, account_type, is_active, created_at, last_seen_at, user_roles(role)")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("app_roles").select("role, name, description, is_active, is_system").order("name", { ascending: true }),
    supabase.from("app_permissions").select("code, module_key, module_label, action_key, action_label, is_critical, sort_order").order("sort_order", { ascending: true }),
    supabase.from("app_role_permissions").select("role, permission_code"),
    supabase.from("app_user_permission_overrides").select("user_id, permission_code, effect")
  ]);

  if (profilesResult.error) throw new Error(profilesResult.error.message);
  if (appRolesResult.error) throw new Error(appRolesResult.error.message);
  if (permissionsResult.error) throw new Error(permissionsResult.error.message);
  if (rolePermissionsResult.error) throw new Error(rolePermissionsResult.error.message);
  if (overridesResult.error) throw new Error(overridesResult.error.message);

  const admin = createSupabaseAdminClient();
  const authUsersById = new Map<string, { email: string | null; created_at: string | null; last_sign_in_at: string | null }>();
  if (admin) {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    data.users.forEach((authUser) => {
      authUsersById.set(authUser.id, {
        email: authUser.email ?? null,
        created_at: authUser.created_at ?? null,
        last_sign_in_at: authUser.last_sign_in_at ?? null
      });
    });
  }

  const rolePermissions = (rolePermissionsResult.data ?? []) as RolePermissionRow[];
  const appRoles = ((appRolesResult.data ?? []) as Omit<RoleRecord, "permissions">[]).map((role) => ({
    ...role,
    permissions: role.role === "admin_sistema"
      ? ((permissionsResult.data ?? []) as PermissionRecord[]).map((permission) => permission.code)
      : rolePermissions.filter((permission) => permission.role === role.role).map((permission) => permission.permission_code)
  }));

  const overrides = (overridesResult.data ?? []) as Array<UserPermissionOverride & { user_id: string }>;
  const profileRows = (profilesResult.data ?? []) as ProfileRow[];
  const usersById = new Map<string, UserPermissionRecord>();

  profileRows.forEach((profile) => {
    const authUser = authUsersById.get(profile.id);
    usersById.set(profile.id, {
      id: profile.id,
      full_name: profile.full_name,
      email: authUser?.email ?? profile.email,
      phone: profile.phone,
      account_type: profile.account_type ?? "client",
      is_active: profile.is_active ?? true,
      created_at: profile.created_at,
      last_seen_at: profile.last_seen_at,
      auth_created_at: authUser?.created_at ?? null,
      auth_last_sign_in_at: authUser?.last_sign_in_at ?? null,
      roles: profile.user_roles?.map((roleRow) => roleRow.role) ?? [],
      overrides: overrides
        .filter((override) => override.user_id === profile.id)
        .map((override) => ({ permission_code: override.permission_code, effect: override.effect }))
    });
  });

  authUsersById.forEach((authUser, id) => {
    if (usersById.has(id)) return;
    usersById.set(id, {
      id,
      full_name: null,
      email: authUser.email,
      phone: null,
      account_type: "client",
      is_active: true,
      created_at: null,
      last_seen_at: null,
      auth_created_at: authUser.created_at,
      auth_last_sign_in_at: authUser.last_sign_in_at,
      roles: [],
      overrides: []
    });
  });

  return (
    <PanelShell active="configuracion" hideHeader roleNames={roleNames} title="Usuarios y permisos" userEmail={user.email ?? "usuario"}>
      <UsersPermissionsModule
        authAdminConfigured={Boolean(admin)}
        currentUserId={user.id}
        permissions={(permissionsResult.data ?? []) as PermissionRecord[]}
        roles={appRoles}
        users={[...usersById.values()]}
      />
    </PanelShell>
  );
}
