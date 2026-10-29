import type { ActivityFilters, TeamState } from "../../lib/api";
import { SelectDropdown } from "../SelectDropdown";

type ActivityFiltersBarProps = {
  teamView: boolean;
  members: TeamState["members"];
  filters: ActivityFilters;
  onFilter: (key: keyof ActivityFilters, value: string) => void;
  onReset: () => void;
  disabled?: boolean;
};

export function ActivityFiltersBar({
  teamView,
  members,
  filters,
  onFilter,
  onReset,
  disabled = false,
}: ActivityFiltersBarProps) {
  return (
    <div className="activity-filters">
      {teamView && (
        <div className="activity-filter">
          <span>Member</span>
          <SelectDropdown
            disabled={disabled}
            label="Member"
            value={filters.user_id ?? ""}
            onChange={(value) => onFilter("user_id", value)}
            options={[
              { value: "", label: "All members" },
              ...members.map((member) => ({
                value: member.user_id,
                label: member.display_name || member.email || member.user_id,
              })),
            ]}
          />
        </div>
      )}
      <div className="activity-filter">
        <span>Final result</span>
        <SelectDropdown
          disabled={disabled}
          label="Final result"
          value={filters.result ?? ""}
          onChange={(value) => onFilter("result", value)}
          options={[
            { value: "", label: "All results" },
            { value: "true", label: "Hot dog" },
            { value: "false", label: "Not hot dog" },
          ]}
        />
      </div>
      <div className="activity-filter">
        <span>Human review</span>
        <SelectDropdown
          disabled={disabled}
          label="Human review"
          value={filters.verification ?? ""}
          onChange={(value) => onFilter("verification", value)}
          options={[
            { value: "", label: "All statuses" },
            { value: "unreviewed", label: "Not requested" },
            { value: "pending", label: "Pending" },
            { value: "verified", label: "Verified" },
          ]}
        />
      </div>
      <div className="activity-filter">
        <span>Model</span>
        <SelectDropdown
          disabled={disabled}
          label="Model"
          value={filters.model ?? ""}
          onChange={(value) => onFilter("model", value)}
          options={[
            { value: "", label: "All models" },
            { value: "haiku", label: "Quick Bite" },
            { value: "sonnet", label: "The Food Inspector" },
          ]}
        />
      </div>
      <button
        className="activity-refresh"
        disabled={disabled}
        onClick={onReset}
      >
        Reset filters
      </button>
    </div>
  );
}
