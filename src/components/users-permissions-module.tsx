"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil, Plus, Settings, ShieldCheck, X } from "lucide-react";
import {
  registerSystemUser,
  saveSystemRole,
  saveUserPermissionOverrides,
  updateSystemUser,
  type FormActionState
} from "@/app/admin/actions";
import type { SystemModuleKey } from "@/lib/system-modules";

type RoleKey = "vendedor" | "mesero" | "cocina" | "mensajero" | "gerente" | "admin_sistema";

export type PermissionRecord = {
  code: string;
  module_key: string;
  module_label: string;
  action_key: string;
  action_label: string;
  is_critical: boolean;
  sort_order: number;
};

export type RoleRecord = {
  role: RoleKey;
  name: string;
  description: string | null;
  is_active: boolean;
  is_system: boolean;
  permissions: string[];
};

export type UserPermissionOverride = {
  permission_code: string;
  effect: "allow" | "deny";
};

export type UserPermissionRecord = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  account_type: "staff" | "client";
  is_active: boolean;
  created_at: string | null;
  last_seen_at: string | null;
  auth_created_at?: string | null;
  auth_last_sign_in_at?: string | null;
  roles: RoleKey[];
  module_access: string[];
  overrides: UserPermissionOverride[];
};

export type SystemModuleRecord = {
  key: SystemModuleKey;
  name: string;
  route: string;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  parent_key: string | null;
};

type UsersPermissionsModuleProps = {
  currentUserId: string;
  users: UserPermissionRecord[];
  roles: RoleRecord[];
  modules: SystemModuleRecord[];
  permissions: PermissionRecord[];
  authAdminConfigured: boolean;
};

type UserColumn = "name" | "email" | "type" | "role" | "status" | "lastAccess" | "createdAt" | "actions";
const userColumns: UserColumn[] = ["name", "email", "type", "role", "status", "lastAccess", "createdAt", "actions"];
const defaultUserColumns: UserColumn[] = ["name", "email", "type", "role", "status", "lastAccess", "createdAt", "actions"];
const userColumnLabels: Record<UserColumn, string> = {
  name: "Nombre",
  email: "Email",
  type: "Tipo",
  role: "Rol",
  status: "Estado",
  lastAccess: "Ultimo acceso",
  createdAt: "Fecha creacion",
  actions: "Acciones"
};
const columnStorageKey = "modopizzas.users-permissions.user-columns";

const initialState: FormActionState = { status: "idle", message: "" };

function readUserColumns() {
  if (typeof window === "undefined") return defaultUserColumns;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(columnStorageKey) ?? "[]") as UserColumn[];
    const clean = Array.isArray(parsed) ? parsed.filter((column) => userColumns.includes(column)) : [];
    return clean.length ? clean : defaultUserColumns;
  } catch {
    window.localStorage.removeItem(columnStorageKey);
    return defaultUserColumns;
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Sin registro";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function roleLabel(role: string, roles: RoleRecord[]) {
  return roles.find((item) => item.role === role)?.name ?? role;
}

function roleNames(user: UserPermissionRecord, roles: RoleRecord[]) {
  if (user.account_type === "client") return "Sin rol interno";
  return user.roles.length ? user.roles.map((role) => roleLabel(role, roles)).join(", ") : "Sin rol";
}

function groupPermissions(permissions: PermissionRecord[]) {
  return permissions.reduce<Array<{ key: string; label: string; permissions: PermissionRecord[] }>>((groups, permission) => {
    const group = groups.find((item) => item.key === permission.module_key);
    if (group) {
      group.permissions.push(permission);
      return groups;
    }
    return [...groups, { key: permission.module_key, label: permission.module_label, permissions: [permission] }];
  }, []);
}

function inheritedPermissions(user: UserPermissionRecord, roles: RoleRecord[]) {
  const codes = new Set<string>();
  user.roles.forEach((role) => {
    roles.find((item) => item.role === role)?.permissions.forEach((permission) => codes.add(permission));
  });
  return codes;
}

function effectivePermissions(user: UserPermissionRecord, roles: RoleRecord[], permissions: PermissionRecord[]) {
  if (user.roles.includes("admin_sistema")) return new Set(permissions.map((permission) => permission.code));
  const effective = inheritedPermissions(user, roles);
  user.overrides.forEach((override) => {
    if (override.effect === "allow") effective.add(override.permission_code);
    if (override.effect === "deny") effective.delete(override.permission_code);
  });
  return effective;
}

function SubmitButton({ children, disabled = false }: { children: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" disabled={pending || disabled} type="submit">
      {pending ? "Guardando..." : children}
    </button>
  );
}

export function UsersPermissionsModule({ currentUserId, users, roles, modules, permissions, authAdminConfigured }: UsersPermissionsModuleProps) {
  const [tab, setTab] = useState<"users" | "roles">("users");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [columns, setColumns] = useState<UserColumn[]>(readUserColumns);
  const [showColumns, setShowColumns] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserPermissionRecord | null>(null);
  const [permissionUser, setPermissionUser] = useState<UserPermissionRecord | null>(null);
  const [editingRole, setEditingRole] = useState<RoleRecord | null>(null);

  const [registerState, registerAction] = useActionState(registerSystemUser, initialState);
  const [userState, userAction] = useActionState(updateSystemUser, initialState);
  const [roleState, roleAction] = useActionState(saveSystemRole, initialState);
  const [overrideState, overrideAction] = useActionState(saveUserPermissionOverrides, initialState);

  useEffect(() => {
    window.localStorage.setItem(columnStorageKey, JSON.stringify(columns));
  }, [columns]);

  useEffect(() => {
    if (registerState.status === "success") {
      const timer = window.setTimeout(() => setRegisterOpen(false), 0);
      return () => window.clearTimeout(timer);
    }
  }, [registerState.status]);

  useEffect(() => {
    if (userState.status === "success") {
      const timer = window.setTimeout(() => setEditingUser(null), 0);
      return () => window.clearTimeout(timer);
    }
  }, [userState.status]);

  useEffect(() => {
    if (roleState.status === "success") {
      const timer = window.setTimeout(() => setEditingRole(null), 0);
      return () => window.clearTimeout(timer);
    }
  }, [roleState.status]);

  useEffect(() => {
    if (overrideState.status === "success") {
      const timer = window.setTimeout(() => setPermissionUser(null), 0);
      return () => window.clearTimeout(timer);
    }
  }, [overrideState.status]);

  const permissionGroups = useMemo(() => groupPermissions(permissions), [permissions]);
  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toUpperCase();
    return users.filter((user) => {
      const matchesQuery =
        !normalizedQuery ||
        `${user.full_name ?? ""} ${user.email ?? ""} ${user.phone ?? ""}`.toUpperCase().includes(normalizedQuery);
      const matchesType = typeFilter === "all" || user.account_type === typeFilter;
      const matchesRole = roleFilter === "all" || (user.account_type === "staff" && user.roles.includes(roleFilter as RoleKey));
      const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? user.is_active : !user.is_active);
      return matchesQuery && matchesType && matchesRole && matchesStatus;
    });
  }, [query, roleFilter, statusFilter, typeFilter, users]);

  const visibleColumn = (column: UserColumn) => columns.includes(column);
  const toggleColumn = (column: UserColumn) => {
    setColumns((current) => {
      if (current.includes(column)) return current.filter((item) => item !== column);
      return [...current, column];
    });
  };

  return (
    <section className="module-stack users-permissions-module">
      <div className="section-title-row inventory-toolbar-row">
        <div className="segmented-tabs">
          <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")} type="button">
            Usuarios
          </button>
          <button className={tab === "roles" ? "active" : ""} onClick={() => setTab("roles")} type="button">
            Roles
          </button>
        </div>
        <div className="toolbar-actions">
          {tab === "users" ? (
            <>
              <button className="ghost-button icon-button" onClick={() => setShowColumns(true)} title="Configurar columnas" type="button">
                <Settings size={18} />
              </button>
              <button className="primary-button" onClick={() => setRegisterOpen(true)} type="button">
                <Plus size={18} />
                Registrar usuario
              </button>
            </>
          ) : null}
        </div>
      </div>

      {tab === "users" ? (
        <>
          <div className="inventory-filters compact-user-filters">
            <input aria-label="Buscar usuario" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar usuario" value={query} />
            <select aria-label="Filtrar por tipo" onChange={(event) => setTypeFilter(event.target.value)} value={typeFilter}>
              <option value="all">Todos</option>
              <option value="staff">Personal</option>
              <option value="client">Clientes</option>
            </select>
            <select aria-label="Filtrar por rol" onChange={(event) => setRoleFilter(event.target.value)} value={roleFilter}>
              <option value="all">Todos los roles</option>
              {roles.map((role) => (
                <option key={role.role} value={role.role}>
                  {role.name}
                </option>
              ))}
            </select>
            <select aria-label="Filtrar por estado" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
              <option value="all">Todos</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </select>
          </div>
          <div className="table-scroll">
            <table className="data-table compact-table">
              <thead>
                <tr>
                  {visibleColumn("name") ? <th>Nombre</th> : null}
                  {visibleColumn("email") ? <th>Email</th> : null}
                  {visibleColumn("type") ? <th>Tipo</th> : null}
                  {visibleColumn("role") ? <th>Rol</th> : null}
                  {visibleColumn("status") ? <th>Estado</th> : null}
                  {visibleColumn("lastAccess") ? <th>Ultimo acceso</th> : null}
                  {visibleColumn("createdAt") ? <th>Fecha creacion</th> : null}
                  {visibleColumn("actions") ? <th className="actions-column compact-actions-column">Acciones</th> : null}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id}>
                    {visibleColumn("name") ? (
                      <td>
                        <strong>{user.full_name || "Sin nombre"}</strong>
                        {user.id === currentUserId ? <small className="muted">Tu usuario</small> : null}
                      </td>
                    ) : null}
                    {visibleColumn("email") ? <td>{user.email ?? "Sin email"}</td> : null}
                    {visibleColumn("type") ? <td>{user.account_type === "staff" ? "Personal" : "Cliente"}</td> : null}
                    {visibleColumn("role") ? <td>{roleNames(user, roles)}</td> : null}
                    {visibleColumn("status") ? (
                      <td>
                        <span className={`stock-pill ${user.is_active ? "ok" : "muted"}`}>{user.is_active ? "Activo" : "Inactivo"}</span>
                      </td>
                    ) : null}
                    {visibleColumn("lastAccess") ? <td>{formatDateTime(user.auth_last_sign_in_at ?? user.last_seen_at)}</td> : null}
                    {visibleColumn("createdAt") ? <td>{formatDateTime(user.auth_created_at ?? user.created_at)}</td> : null}
                    {visibleColumn("actions") ? (
                      <td className="actions-cell">
                        <button className="icon-action" onClick={() => setEditingUser(user)} title="Editar usuario" type="button">
                          <Pencil size={16} />
                        </button>
                        <button className="icon-action" onClick={() => setPermissionUser(user)} title="Permisos efectivos" type="button">
                          <ShieldCheck size={16} />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={userColumns.length}>No hay usuarios para los filtros seleccionados.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <RolesPanel roles={roles} permissions={permissions} permissionGroups={permissionGroups} onEdit={setEditingRole} />
      )}

      {showColumns ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-label="Configuracion de columnas" aria-modal="true" className="modal-panel inventory-settings-modal" role="dialog">
            <header className="modal-header">
              <h2>Columnas</h2>
              <button className="icon-button" onClick={() => setShowColumns(false)} type="button">
                <X size={18} />
              </button>
            </header>
            <div className="modal-content">
              <div className="settings-options">
                {userColumns.map((column) => (
                  <label key={column}>
                    <input checked={columns.includes(column)} onChange={() => toggleColumn(column)} type="checkbox" />
                    {userColumnLabels[column]}
                  </label>
                ))}
              </div>
            </div>
            <footer className="form-actions modal-form-actions">
              <button className="ghost-button" onClick={() => setColumns(defaultUserColumns)} type="button">
                Restablecer columnas
              </button>
              <button className="primary-button" onClick={() => setShowColumns(false)} type="button">
                Cerrar
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {registerOpen ? (
        <RegisterUserModal action={registerAction} authAdminConfigured={authAdminConfigured} modules={modules} roles={roles} state={registerState} onClose={() => setRegisterOpen(false)} />
      ) : null}
      {editingUser ? (
        <EditUserModal action={userAction} modules={modules} roles={roles} state={userState} user={editingUser} onClose={() => setEditingUser(null)} />
      ) : null}
      {permissionUser ? (
        <UserPermissionsModal
          action={overrideAction}
          permissions={permissions}
          permissionGroups={permissionGroups}
          roles={roles}
          state={overrideState}
          user={permissionUser}
          onClose={() => setPermissionUser(null)}
        />
      ) : null}
      {editingRole ? (
        <RoleModal action={roleAction} permissionGroups={permissionGroups} role={editingRole} state={roleState} onClose={() => setEditingRole(null)} />
      ) : null}
    </section>
  );
}

function RoleSelect({ roles, value, onChange }: { roles: RoleRecord[]; value: RoleKey; onChange: (role: RoleKey) => void }) {
  return (
    <>
      <input name="roles" type="hidden" value={JSON.stringify([value])} />
      <select aria-label="Rol principal" onChange={(event) => onChange(event.target.value as RoleKey)} value={value}>
        {roles.filter((role) => role.is_active || role.role === "admin_sistema").map((role) => (
          <option key={role.role} value={role.role}>{role.name}</option>
        ))}
      </select>
    </>
  );
}

function ModuleAccessFields({
  modules,
  selectedModules,
  isAdmin,
  onChange
}: {
  modules: SystemModuleRecord[];
  selectedModules: SystemModuleKey[];
  isAdmin: boolean;
  onChange: (modules: SystemModuleKey[]) => void;
}) {
  const moduleKeys = modules.map((module) => module.key);
  const effectiveModules = isAdmin ? moduleKeys : selectedModules;
  return (
    <div className="field full-row user-modal-section">
      <input name="module_access" type="hidden" value={JSON.stringify(effectiveModules)} />
      <div className="permission-group-header">
        <strong>Acceso a modulos</strong>
        {!isAdmin ? (
          <div className="toolbar-actions">
            <button className="ghost-button small-button" onClick={() => onChange(moduleKeys)} type="button">Seleccionar todos</button>
            <button className="ghost-button small-button" onClick={() => onChange([])} type="button">Quitar todos</button>
          </div>
        ) : null}
      </div>
      <div className="module-access-grid">
        {modules.map((module) => (
          <label className="permission-chip module-access-chip" key={module.key}>
            <input
              checked={effectiveModules.includes(module.key)}
              disabled={isAdmin}
              onChange={() => onChange(effectiveModules.includes(module.key) ? effectiveModules.filter((key) => key !== module.key) : [...effectiveModules, module.key])}
              type="checkbox"
            />
            {module.name}
          </label>
        ))}
      </div>
      {isAdmin ? <small className="muted">Administrador del sistema conserva acceso total permanente.</small> : null}
    </div>
  );
}

function RegisterUserModal({
  action,
  authAdminConfigured,
  modules,
  roles,
  state,
  onClose
}: {
  action: (payload: FormData) => void;
  authAdminConfigured: boolean;
  modules: SystemModuleRecord[];
  roles: RoleRecord[];
  state: FormActionState;
  onClose: () => void;
}) {
  const [role, setRole] = useState<RoleKey>("vendedor");
  const [selectedModules, setSelectedModules] = useState<SystemModuleKey[]>([]);
  const isAdmin = role === "admin_sistema";
  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label="Registrar usuario" aria-modal="true" className="modal-panel purchase-modal" role="dialog">
        <form action={action}>
          <header className="modal-header">
            <h2>Registrar usuario</h2>
            <button className="icon-button" onClick={onClose} type="button">
              <X size={18} />
            </button>
          </header>
          <div className="modal-content form-grid">
            {!authAdminConfigured ? <p className="form-error">El registro de usuarios no esta disponible temporalmente.</p> : null}
            <label className="field">
              Nombre
              <input name="full_name" placeholder="NOMBRE" required />
            </label>
            <label className="field">
              Usuario/correo de acceso
              <input name="email" placeholder="usuario@correo.com" required type="email" />
            </label>
            <label className="field">
              Contrasena
              <input autoComplete="new-password" name="password" required type="password" />
            </label>
            <label className="field">
              Confirmar contrasena
              <input autoComplete="new-password" name="password_confirmation" required type="password" />
            </label>
            <label className="field">
              Telefono
              <input name="phone" placeholder="3001234567" />
            </label>
            <div className="field full-row">
              <strong>Rol principal</strong>
              <RoleSelect onChange={setRole} roles={roles} value={role} />
            </div>
            <label className="checkbox-field">
              <input defaultChecked name="is_active" type="checkbox" />
              Activo
            </label>
            <ModuleAccessFields isAdmin={isAdmin} modules={modules} onChange={setSelectedModules} selectedModules={selectedModules} />
            {state.status === "error" ? <p className="form-error full-row">{state.message}</p> : null}
          </div>
          <footer className="form-actions modal-form-actions">
            <button className="ghost-button" onClick={onClose} type="button">
              Cancelar
            </button>
            <SubmitButton disabled={!authAdminConfigured}>Registrar usuario</SubmitButton>
          </footer>
        </form>
      </section>
    </div>
  );
}

function EditUserModal({
  action,
  modules,
  roles,
  state,
  user,
  onClose
}: {
  action: (payload: FormData) => void;
  modules: SystemModuleRecord[];
  roles: RoleRecord[];
  state: FormActionState;
  user: UserPermissionRecord;
  onClose: () => void;
}) {
  const [accountType, setAccountType] = useState<"staff" | "client">(user.account_type);
  const [role, setRole] = useState<RoleKey>(user.roles[0] ?? "vendedor");
  const isAdminUser = accountType === "staff" && role === "admin_sistema";
  const allModuleKeys = modules.map((module) => module.key);
  const initialModuleAccess = user.roles.includes("admin_sistema") ? allModuleKeys : user.module_access.filter((key): key is SystemModuleKey => allModuleKeys.includes(key as SystemModuleKey));
  const [selectedModules, setSelectedModules] = useState<SystemModuleKey[]>(initialModuleAccess);
  const effectiveSelectedModules = isAdminUser ? allModuleKeys : accountType === "client" ? [] : selectedModules;
  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label="Editar usuario" aria-modal="true" className="modal-panel purchase-modal" role="dialog">
        <form action={action}>
          <header className="modal-header">
            <h2>Editar usuario</h2>
            <button className="icon-button" onClick={onClose} type="button">
              <X size={18} />
            </button>
          </header>
          <div className="modal-content form-grid">
            <input name="user_id" type="hidden" value={user.id} />
            <label className="field">
              Nombre
              <input defaultValue={user.full_name ?? ""} name="full_name" />
            </label>
            <label className="field">
              Email
              <input defaultValue={user.email ?? ""} disabled />
            </label>
            <label className="field">
              Telefono
              <input defaultValue={user.phone ?? ""} name="phone" />
            </label>
            <label className="field">
              Tipo
              <select name="account_type" onChange={(event) => setAccountType(event.target.value === "client" ? "client" : "staff")} value={accountType}>
                <option value="staff">Personal</option>
                <option value="client">Cliente</option>
              </select>
            </label>
            <label className="checkbox-field">
              <input defaultChecked={user.is_active} name="is_active" type="checkbox" />
              Activo
            </label>
            {accountType === "staff" ? (
              <div className="field full-row user-modal-section">
                <strong>Rol principal</strong>
                <RoleSelect onChange={setRole} roles={roles} value={role} />
              </div>
            ) : (
              <p className="muted full-row">Cliente sin acceso al panel administrativo.</p>
            )}
            {accountType === "staff" ? (
              <ModuleAccessFields isAdmin={isAdminUser} modules={modules} onChange={setSelectedModules} selectedModules={effectiveSelectedModules} />
            ) : null}
            <div className="field full-row user-modal-section">
              <strong>Cambiar contrasena</strong>
              <div className="form-grid">
                <label className="field">
                  Nueva contrasena
                  <input autoComplete="new-password" name="password" type="password" />
                </label>
                <label className="field">
                  Confirmar contrasena
                  <input autoComplete="new-password" name="password_confirmation" type="password" />
                </label>
              </div>
            </div>
            {state.status === "error" ? <p className="form-error full-row">{state.message}</p> : null}
          </div>
          <footer className="form-actions modal-form-actions">
            <button className="ghost-button" onClick={onClose} type="button">
              Cancelar
            </button>
            <SubmitButton>Guardar usuario</SubmitButton>
          </footer>
        </form>
      </section>
    </div>
  );
}

function RolesPanel({
  roles,
  permissions,
  permissionGroups,
  onEdit
}: {
  roles: RoleRecord[];
  permissions: PermissionRecord[];
  permissionGroups: ReturnType<typeof groupPermissions>;
  onEdit: (role: RoleRecord) => void;
}) {
  return (
    <div className="roles-grid">
      {roles.map((role) => {
        const granted = role.role === "admin_sistema" ? permissions.length : role.permissions.length;
        return (
          <article className="role-card" key={role.role}>
            <div>
              <strong>{role.name}</strong>
              <small>{role.description ?? "Sin descripcion"}</small>
            </div>
            <span className={`stock-pill ${role.is_active ? "ok" : "muted"}`}>{role.is_active ? "Activo" : "Inactivo"}</span>
            <span className="muted">{granted} permisos</span>
            <button className="ghost-button" onClick={() => onEdit(role)} type="button">
              <Pencil size={16} />
              Editar
            </button>
          </article>
        );
      })}
      {permissionGroups.length === 0 ? <p className="muted">No hay permisos configurados.</p> : null}
    </div>
  );
}

function RoleModal({
  action,
  permissionGroups,
  role,
  state,
  onClose
}: {
  action: (payload: FormData) => void;
  permissionGroups: ReturnType<typeof groupPermissions>;
  role: RoleRecord;
  state: FormActionState;
  onClose: () => void;
}) {
  const [permissions, setPermissions] = useState<string[]>(role.permissions);
  const isAdminRole = role.role === "admin_sistema";
  const togglePermission = (code: string) => {
    if (isAdminRole) return;
    setPermissions((current) => (current.includes(code) ? current.filter((item) => item !== code) : [...current, code]));
  };
  const selectModule = (codes: string[]) => {
    if (isAdminRole) return;
    setPermissions((current) => [...new Set([...current, ...codes])]);
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label="Editar rol" aria-modal="true" className="modal-panel wide-modal" role="dialog">
        <form action={action}>
          <header className="modal-header">
            <h2>Editar rol</h2>
            <button className="icon-button" onClick={onClose} type="button">
              <X size={18} />
            </button>
          </header>
          <div className="modal-content role-permission-modal">
            <input name="role" type="hidden" value={role.role} />
            <input name="permissions" type="hidden" value={JSON.stringify(isAdminRole ? permissionGroups.flatMap((group) => group.permissions.map((permission) => permission.code)) : permissions)} />
            <div className="form-grid">
              <label className="field">
                Nombre
                <input defaultValue={role.name} name="name" required />
              </label>
              <label className="field">
                Descripcion
                <input defaultValue={role.description ?? ""} name="description" />
              </label>
              <label className="checkbox-field">
                <input defaultChecked={role.is_active} disabled={isAdminRole} name="is_active" type="checkbox" />
                Activo
              </label>
            </div>
            <div className="permission-matrix">
              {permissionGroups.map((group) => {
                const codes = group.permissions.map((permission) => permission.code);
                return (
                  <section className="permission-group" key={group.key}>
                    <div className="permission-group-header">
                      <strong>{group.label}</strong>
                      <button className="ghost-button small-button" disabled={isAdminRole} onClick={() => selectModule(codes)} type="button">
                        Seleccionar todos
                      </button>
                    </div>
                    <div className="permission-chip-grid">
                      {group.permissions.map((permission) => (
                        <label className="permission-chip" key={permission.code}>
                          <input checked={isAdminRole || permissions.includes(permission.code)} disabled={isAdminRole} onChange={() => togglePermission(permission.code)} type="checkbox" />
                          {permission.action_label}
                        </label>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
            {isAdminRole ? <p className="muted">admin_sistema conserva acceso total permanente.</p> : null}
            {state.status === "error" ? <p className="form-error">{state.message}</p> : null}
          </div>
          <footer className="form-actions modal-form-actions">
            <button className="ghost-button" onClick={onClose} type="button">
              Cancelar
            </button>
            <SubmitButton>Guardar rol</SubmitButton>
          </footer>
        </form>
      </section>
    </div>
  );
}

function UserPermissionsModal({
  action,
  permissions,
  permissionGroups,
  roles,
  state,
  user,
  onClose
}: {
  action: (payload: FormData) => void;
  permissions: PermissionRecord[];
  permissionGroups: ReturnType<typeof groupPermissions>;
  roles: RoleRecord[];
  state: FormActionState;
  user: UserPermissionRecord;
  onClose: () => void;
}) {
  const [allow, setAllow] = useState<string[]>(user.overrides.filter((item) => item.effect === "allow").map((item) => item.permission_code));
  const [deny, setDeny] = useState<string[]>(user.overrides.filter((item) => item.effect === "deny").map((item) => item.permission_code));
  const inherited = inheritedPermissions(user, roles);
  const effective = effectivePermissions(user, roles, permissions);
  const isAdminUser = user.roles.includes("admin_sistema");
  const isClientUser = user.account_type === "client";

  function setOverride(code: string, effect: "inherit" | "allow" | "deny") {
    if (isAdminUser || isClientUser) return;
    setAllow((current) => current.filter((item) => item !== code));
    setDeny((current) => current.filter((item) => item !== code));
    if (effect === "allow") setAllow((current) => [...current, code]);
    if (effect === "deny") setDeny((current) => [...current, code]);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label="Permisos de usuario" aria-modal="true" className="modal-panel wide-modal" role="dialog">
        <form action={action}>
          <header className="modal-header">
            <h2>Permisos</h2>
            <button className="icon-button" onClick={onClose} type="button">
              <X size={18} />
            </button>
          </header>
          <div className="modal-content role-permission-modal">
            <input name="user_id" type="hidden" value={user.id} />
            <input name="allow" type="hidden" value={JSON.stringify(allow)} />
            <input name="deny" type="hidden" value={JSON.stringify(deny)} />
            <div className="permission-summary">
              <strong>{user.full_name || user.email || "Usuario"}</strong>
              <span>{roleNames(user, roles)}</span>
              <span>{effective.size} permisos efectivos</span>
            </div>
            {permissionGroups.map((group) => (
              <section className="permission-group" key={group.key}>
                <strong>{group.label}</strong>
                <div className="user-override-list">
                  {group.permissions.map((permission) => {
                    const value = allow.includes(permission.code) ? "allow" : deny.includes(permission.code) ? "deny" : "inherit";
                    return (
                      <div className="user-override-row" key={permission.code}>
                        <span>
                          {permission.action_label}
                          <small>{effective.has(permission.code) ? "Permitido" : "Bloqueado"}{inherited.has(permission.code) ? " por rol" : ""}</small>
                        </span>
                        <select disabled={isAdminUser || isClientUser} onChange={(event) => setOverride(permission.code, event.target.value as "inherit" | "allow" | "deny")} value={value}>
                          <option value="inherit">Heredar</option>
                          <option value="allow">Permitir</option>
                          <option value="deny">Bloquear</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
            {isAdminUser ? <p className="muted">Los usuarios admin_sistema no pueden bloquear sus permisos criticos desde aqui.</p> : null}
            {isClientUser ? <p className="muted">Los clientes no tienen acceso al panel. Convierte el usuario a Personal para asignar permisos internos.</p> : null}
            {state.status === "error" ? <p className="form-error">{state.message}</p> : null}
          </div>
          <footer className="form-actions modal-form-actions">
            <button className="ghost-button" onClick={onClose} type="button">
              Cancelar
            </button>
            <SubmitButton disabled={isAdminUser || isClientUser}>Guardar permisos</SubmitButton>
          </footer>
        </form>
      </section>
    </div>
  );
}
