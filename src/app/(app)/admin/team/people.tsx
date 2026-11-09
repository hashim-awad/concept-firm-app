import { formatDateTime } from "@/components/ui";
import { canEdit, type Access } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { inviteStaff, changeRole, setActive, savePhone } from "../staff/actions";

type StaffRow = { id: string; full_name: string; email: string; phone: string; role_id: string; is_active: boolean; created_at: string };
type RoleRow = { id: string; name: string; is_owner: boolean };

// People: everyone who can sign in. Shown on Team and roles.
export async function PeopleSection({ access }: { access: Access }) {
  const editable = canEdit(access, "staff_accounts");
  const supabase = await createClient();

  const [{ data: staff }, { data: roles }] = await Promise.all([
    supabase.from("staff").select("id, full_name, email, phone, role_id, is_active, created_at").order("full_name"),
    supabase.from("roles").select("id, name, is_owner").order("is_owner", { ascending: false }).order("name"),
  ]);
  const roleList = (roles ?? []) as RoleRow[];
  const roleName = new Map(roleList.map((r) => [r.id, r.name]));
  // Non-owners never see the Owner role as a choice. The database enforces the full rule.
  const assignable = roleList.filter((r) => access.is_owner || !r.is_owner);

  return (
    <>
      <p className="mb-4 text-sm text-ink-2">Everyone who can sign in to the app. Switched-off accounts keep their history.</p>

      {editable && (
        <section className="card mb-6">
          <h2 className="mb-3 font-semibold">Invite a staff member</h2>
          <p className="mb-4 text-sm text-muted">They get an email with a link to set their password.</p>
          <form action={inviteStaff} className="grid gap-3 md:grid-cols-[1fr_1fr_12rem_auto] md:items-end">
            <div>
              <label htmlFor="full_name" className="label">Full name</label>
              <input id="full_name" name="full_name" required maxLength={120} className="input" />
            </div>
            <div>
              <label htmlFor="email" className="label">Work email</label>
              <input id="email" name="email" type="email" required className="input" />
            </div>
            <div>
              <label htmlFor="role_id" className="label">Role</label>
              <select id="role_id" name="role_id" required className="input">
                {assignable.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn">Send invite</button>
          </form>
        </section>
      )}

      <section className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Role</th>
              <th>Status</th>
              <th>Added</th>
              {editable && <th className="text-right">Account</th>}
            </tr>
          </thead>
          <tbody>
            {((staff ?? []) as StaffRow[]).map((s) => {
              const isSelf = s.id === access.staff_id;
              return (
                <tr key={s.id}>
                  <td className="font-medium">{s.full_name}{isSelf && <span className="text-muted"> (you)</span>}</td>
                  <td>{s.email}</td>
                  <td>
                    {editable || isSelf ? (
                      <form action={savePhone} className="flex items-center gap-2">
                        <input type="hidden" name="staff_id" value={s.id} />
                        <input name="phone" defaultValue={s.phone} placeholder="226-789-9591" aria-label={`Phone for ${s.full_name}`} className="input w-40" />
                        <button type="submit" className="btn-secondary">Save</button>
                      </form>
                    ) : s.phone}
                  </td>
                  <td>
                    {editable && !isSelf ? (
                      <form action={changeRole} className="flex items-center gap-2">
                        <input type="hidden" name="staff_id" value={s.id} />
                        <select name="role_id" defaultValue={s.role_id} className="input py-1" aria-label={`Role for ${s.full_name}`}>
                          {assignable.some((r) => r.id === s.role_id) ? null : (
                            <option value={s.role_id}>{roleName.get(s.role_id)}</option>
                          )}
                          {assignable.map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                        <button type="submit" className="btn-secondary">Save</button>
                      </form>
                    ) : (
                      roleName.get(s.role_id)
                    )}
                  </td>
                  <td>{s.is_active ? "Active" : <span className="text-muted">Switched off</span>}</td>
                  <td className="whitespace-nowrap text-muted">{formatDateTime(s.created_at)}</td>
                  {editable && (
                    <td className="text-right">
                      {!isSelf && (
                        <form action={setActive}>
                          <input type="hidden" name="staff_id" value={s.id} />
                          <input type="hidden" name="active" value={s.is_active ? "false" : "true"} />
                          <button type="submit" className={s.is_active ? "btn-danger" : "btn-secondary"}>
                            {s.is_active ? "Switch off" : "Switch on"}
                          </button>
                        </form>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
