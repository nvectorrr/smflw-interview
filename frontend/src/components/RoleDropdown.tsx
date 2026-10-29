import { roleLabels } from "../lib/api";
import type { TeamRole } from "../lib/api";
import { SelectDropdown } from "./SelectDropdown";

const roles: TeamRole[] = ["user", "supervisor", "admin"];
const descriptions: Record<TeamRole, string> = {
  user: "Classify images and view personal history",
  supervisor: "Review results and view team activity",
  admin: "Full oversight and team management",
};
const options = roles.map((value) => ({
  value,
  label: roleLabels[value],
  description: descriptions[value],
}));

export function RoleDropdown({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: TeamRole;
  onChange: (role: TeamRole) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <SelectDropdown<TeamRole>
      className="role-dropdown"
      value={value}
      onChange={onChange}
      label={label}
      disabled={disabled}
      options={options}
    />
  );
}
