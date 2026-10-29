import type { TeamMember, TeamRole } from "../../lib/api";
import { RoleDropdown } from "../RoleDropdown";

type TeamMembersProps = {
  members: TeamMember[];
  userId: string;
  busy: boolean;
  loading: boolean;
  onRemove: (member: TeamMember) => void;
  onRoleChange: (userId: string, role: TeamRole) => void;
};

export function TeamMembers({
  members,
  userId,
  busy,
  loading,
  onRemove,
  onRoleChange,
}: TeamMembersProps) {
  const adminCount = members.filter((member) => member.role === "admin").length;
  return (
    <section className="team-card">
      <p className="eyebrow">DIRECTORY</p>
      <h2>Members & roles</h2>
      <p>The team must retain at least one administrator.</p>
      <div className="member-list">
        {members.map((member) => (
          <div className="member-row" key={member.user_id}>
            <div className="member-identity">
              <strong>
                {member.display_name || member.email || "Team member"}
                {member.user_id === userId ? " / You" : ""}
              </strong>
              {member.email && <span>{member.email}</span>}
              {member.user_id !== userId && (
                <button
                  className="member-remove"
                  type="button"
                  disabled={
                    busy ||
                    loading ||
                    (member.role === "admin" && adminCount <= 1)
                  }
                  aria-label={`Remove ${member.display_name || member.email || "member"} from team`}
                  onClick={() => onRemove(member)}
                >
                  Remove
                </button>
              )}
            </div>
            <div className="member-actions">
              <RoleDropdown
                label={`Role for ${member.display_name || member.email || "member"}`}
                value={member.role}
                disabled={
                  busy ||
                  loading ||
                  (member.role === "admin" && adminCount <= 1)
                }
                onChange={(next) => onRoleChange(member.user_id, next)}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
