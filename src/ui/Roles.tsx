// Roles page (C-8.5) and per-viewer permission overrides (C-8.7). The theatre checks every rule again; its rejections
// are shown on the page.
import { useEffect, useRef, useState } from "react";
import { Permissions, type Role } from "../core/protocol";
import {
  CATALOGUE,
  COHOST_ROLE,
  defaultPosition,
  MAX_CUSTOM_ROLES,
  rankOf,
  RANK,
  ROLE_COLOURS,
  roleAccess,
  VIEWER_ROLE,
} from "../core/rbac";
import type { ScreenSession } from "../core/session";
import { ConfirmDialog, Dialog, describeError, useSubscribe } from "./common";

/** Shows theatre errors that arrive shortly after an action on this page. */
function useActionErrors(s: ScreenSession) {
  const [error, setError] = useState<string | null>(null);
  const last = useRef(0);
  useEffect(
    () =>
      s.error.on((e) => {
        if (performance.now() - last.current < 4000) setError(describeError(e.code, e.message));
      }),
    [s],
  );
  return {
    error,
    clear: () => setError(null),
    acted: () => {
      last.current = performance.now();
      setError(null);
    },
  };
}

const groups = [...new Set(CATALOGUE.map((c) => c.group))];

type Editing = { mode: "new" } | { mode: "edit"; id: string } | null;

export function RolesDialog({ session: s, onClose }: { session: ScreenSession; onClose: () => void }) {
  useSubscribe(s.changed);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const errs = useActionErrors(s);
  const me = s.self;
  const canManage = s.can(Permissions.RolesManage);
  const sorted = [...s.roles].sort((a, b) => b.position - a.position);
  const customCount = s.roles.filter((r) => !r.builtin).length;
  const full = customCount >= MAX_CUSTOM_ROLES;

  if (editing) {
    const role = editing.mode === "edit" ? s.roles.find((r) => r.id === editing.id) : undefined;
    if (editing.mode === "edit" && !role) {
      setEditing(null); // deleted meanwhile
      return null;
    }
    return <RoleEditor session={s} role={role} onDone={() => setEditing(null)} />;
  }

  return (
    <Dialog title="Roles" onClose={onClose}>
      <p className="muted small">
        {canManage
          ? "Higher roles rank above lower ones. You can edit roles below your own rank."
          : "Only people with the “Create and edit roles” permission can change roles."}
      </p>
      <div className="list">
        {sorted.map((r) => {
          const access = roleAccess(me, r, s.roles);
          const rankLabel = r.id === COHOST_ROLE ? "900 (built in)" : r.id === VIEWER_ROLE ? "0 (everyone)" : String(r.position);
          return (
            <div key={r.id} className="list-item">
              <div style={{ minWidth: 0 }}>
                <div className="name">
                  <span className="role-dot" style={{ background: r.colour ?? "var(--muted)" }} aria-hidden="true" /> {r.name}
                  {!access.editable && canManage && (
                    <span className="badge" title={r.id === COHOST_ROLE ? "The Co-host role is fixed" : "Ranks at or above you"}>
                      🔒
                    </span>
                  )}
                </div>
                <div className="small muted">
                  Rank {rankLabel} · {r.permissions.length} permission{r.permissions.length === 1 ? "" : "s"}
                </div>
              </div>
              <div className="row" style={{ gap: 2 }}>
                <button className="btn small" onClick={() => setEditing({ mode: "edit", id: r.id })}>
                  {access.editable ? "Edit" : "View"}
                </button>
                {access.deletable && (
                  <button className="btn small ghost danger" onClick={() => setDeleting(r)} aria-label={`Delete ${r.name}`}>
                    ✕
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {errs.error && <p className="error-text small">{errs.error}</p>}
      <div className="actions">
        {canManage && (
          <button
            className="btn"
            disabled={full}
            title={full ? `A screen can have at most ${MAX_CUSTOM_ROLES} roles` : undefined}
            onClick={() => setEditing({ mode: "new" })}
          >
            ＋ New role
          </button>
        )}
        {full && <span className="muted small">At most {MAX_CUSTOM_ROLES} roles.</span>}
        <span className="spacer" />
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
      {deleting && (
        <ConfirmDialog
          title="Delete role"
          text={`Delete the role “${deleting.name}”? It is removed from everyone who has it.`}
          confirm="Delete"
          onConfirm={() => {
            errs.acted();
            s.deleteRole(deleting.id);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </Dialog>
  );
}

function RoleEditor({ session: s, role, onDone }: { session: ScreenSession; role: Role | undefined; onDone: () => void }) {
  const me = s.self;
  const myRank = me ? rankOf(me, s.roles) : 0;
  const maxRank = Math.min(myRank - 1, RANK.customMax);
  const access = role
    ? roleAccess(me, role, s.roles)
    : { editable: true, detailsEditable: true, deletable: false, grantable: (p: string) => !!me?.permissions?.includes(p) };
  const [name, setName] = useState(role?.name ?? "");
  const [colour, setColour] = useState<string | null>(role?.colour ?? ROLE_COLOURS[5]!);
  const [position, setPosition] = useState(role?.position ?? defaultPosition(myRank, s.roles));
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? []);
  const errs = useActionErrors(s);
  const readOnly = !access.editable;

  const nameOk = name.trim().length >= 1 && name.trim().length <= 32;
  const rankOk = !access.detailsEditable || (Number.isInteger(position) && position >= RANK.customMin && position <= maxRank);

  const save = () => {
    if (!nameOk || !rankOk) return;
    errs.acted();
    const ordered = CATALOGUE.map((c) => c.key).filter((k) => perms.includes(k));
    if (!role) s.createRole(name.trim(), colour, ordered, position);
    else if (!access.detailsEditable) s.updateRole(role.id, { permissions: ordered });
    else s.updateRole(role.id, { name: name.trim(), colour, position, permissions: ordered });
    onDone();
  };

  return (
    <Dialog title={role ? (readOnly ? role.name : `Edit ${role.name}`) : "New role"} onClose={onDone}>
      {readOnly && (
        <p className="muted small">
          {role?.id === COHOST_ROLE ? "The Co-host role is fixed: co-hosts can do everything." : "You can't change this role."}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!readOnly) save();
        }}
      >
        <fieldset className="plain" disabled={readOnly}>
          {access.detailsEditable && (
            <>
              <label className="field">
                Name
                <input className="input" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
              </label>
              <div className="field">
                Colour
                <div className="row" style={{ flexWrap: "wrap" }}>
                  {ROLE_COLOURS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`swatch ${colour === c ? "on" : ""}`}
                      style={{ background: c }}
                      aria-label={c}
                      aria-pressed={colour === c}
                      onClick={() => setColour(c)}
                    />
                  ))}
                  <button type="button" className={`btn small ${colour === null ? "primary" : ""}`} onClick={() => setColour(null)}>
                    None
                  </button>
                </div>
              </div>
              <label className="field">
                Rank (1 to {maxRank}; higher ranks above lower)
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={maxRank}
                  value={position}
                  onChange={(e) => setPosition(Math.round(Number(e.target.value)))}
                />
              </label>
            </>
          )}
          <div className="field">Permissions</div>
          {groups.map((g) => (
            <div key={g} className="perm-group">
              <div className="small muted">{g}</div>
              {CATALOGUE.filter((c) => c.group === g).map((c) => {
                const on = perms.includes(c.key);
                const grantable = access.grantable(c.key);
                return (
                  <label key={c.key} className="check small" title={!grantable && !on ? "You don't have this permission" : undefined}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!on && !grantable}
                      onChange={(e) => setPerms((ps) => (e.target.checked ? [...ps, c.key] : ps.filter((p) => p !== c.key)))}
                    />
                    {c.label}
                  </label>
                );
              })}
            </div>
          ))}
        </fieldset>
        {!nameOk && access.detailsEditable && <p className="error-text small">A role needs a name (1 to 32 characters).</p>}
        {!rankOk && <p className="error-text small">The rank must be 1 to {maxRank}.</p>}
        {errs.error && <p className="error-text small">{errs.error}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onDone}>
            {readOnly ? "Back" : "Cancel"}
          </button>
          {!readOnly && (
            <button className="btn primary" disabled={!nameOk || !rankOk}>
              {role ? "Save" : "Create"}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

type Choice = "inherit" | "allow" | "deny";

/** Per-viewer overrides (C-8.7): each permission Inherit (showing what the roles give), Allow or Deny. */
export function OverridesDialog({ session: s, viewerId, onClose }: { session: ScreenSession; viewerId: string; onClose: () => void }) {
  useSubscribe(s.changed);
  const target = s.viewers.find((v) => v.id === viewerId);
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(
      CATALOGUE.map((c) => [c.key, target?.allow?.includes(c.key) ? "allow" : target?.deny?.includes(c.key) ? "deny" : "inherit"]),
    ),
  );
  if (!target) {
    return (
      <Dialog title="Permissions" onClose={onClose}>
        <p>That viewer has left.</p>
        <div className="actions">
          <button className="btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </Dialog>
    );
  }
  // What their roles give them, without overrides: Viewer for everyone, plus their custom roles (co-hosts have all).
  const fromRoles = (p: string) =>
    target.coHost != null ||
    s.roles.some((r) => (r.id === VIEWER_ROLE || (!r.builtin && (target.roles ?? []).includes(r.id))) && r.permissions.includes(p));
  const mine = new Set(s.self?.permissions ?? []);

  return (
    <Dialog title={`Permissions for ${target.name}`} onClose={onClose}>
      <p className="muted small">Deny beats Allow, and Allow beats roles. Inherit uses their roles.</p>
      {groups.map((g) => (
        <div key={g} className="perm-group">
          <div className="small muted">{g}</div>
          {CATALOGUE.filter((c) => c.group === g).map((c) => (
            <div key={c.key} className="override-row small">
              <span>{c.label}</span>
              <select
                className="input"
                value={choices[c.key]}
                onChange={(e) => setChoices((ch) => ({ ...ch, [c.key]: e.target.value as Choice }))}
                aria-label={c.label}
              >
                <option value="inherit">Inherit ({fromRoles(c.key) ? "allowed" : "not allowed"})</option>
                <option value="allow" disabled={!mine.has(c.key)}>
                  Allow{mine.has(c.key) ? "" : " (you don't have it)"}
                </option>
                <option value="deny">Deny</option>
              </select>
            </div>
          ))}
        </div>
      ))}
      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          onClick={() => {
            const allow = CATALOGUE.map((c) => c.key).filter((k) => choices[k] === "allow");
            const deny = CATALOGUE.map((c) => c.key).filter((k) => choices[k] === "deny");
            s.setOverrides(target.id, allow, deny);
            onClose();
          }}
        >
          Save
        </button>
      </div>
    </Dialog>
  );
}
