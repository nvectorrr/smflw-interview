import { modelLabel } from "../../lib/api";
import type { UsageStats } from "../../lib/api";

const number = (value: number) => value.toLocaleString("en-GB");

type ActivityStatsProps = {
  stats: UsageStats | null;
};

export function ActivityStats({ stats }: ActivityStatsProps) {
  return (
    <>
      <div className="stats-grid">
        {[
          ["Checks in scope", stats?.total_checks],
          ["Hot dogs", stats?.hot_dogs],
          ["Not hot dogs", stats?.not_hot_dogs],
          ["Cache hits", stats?.cache_hits],
        ].map(([label, value]) => (
          <div className="stat" key={label}>
            <span>{label}</span>
            <strong>
              {stats ? (
                number(value as number)
              ) : (
                <i className="activity-placeholder">0</i>
              )}
            </strong>
          </div>
        ))}
      </div>
      <details className="usage-details">
        <summary>
          {stats ? (
            <>
              Model usage / {number(stats.llm_calls)} calls ·{" "}
              {number(stats.input_tokens + stats.output_tokens)} tokens
            </>
          ) : (
            <span className="activity-placeholder">
              Model usage / loading calls and tokens
            </span>
          )}
        </summary>
        {stats?.models.map((item) => (
          <p key={item.model}>
            <strong>{modelLabel(item.model)}</strong> · {number(item.checks)}{" "}
            checks · {number(item.cache_hits)} cached ·{" "}
            {number(item.input_tokens)} input / {number(item.output_tokens)}{" "}
            output tokens
          </p>
        ))}
      </details>
    </>
  );
}
