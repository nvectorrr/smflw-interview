import { modelLabels } from "../lib/api";
import type { DetectorModel } from "../lib/api";

type ModelSelectorProps = {
  model: DetectorModel;
  busy: boolean;
  onChange: (model: DetectorModel) => void;
};

export function ModelSelector({ model, busy, onChange }: ModelSelectorProps) {
  return (
    <fieldset className="model-selector" disabled={busy}>
      <legend>Choose your inspector</legend>
      {(["haiku", "sonnet"] as const).map((value) => (
        <label key={value} className={model === value ? "selected" : ""}>
          <input
            type="radio"
            name="model"
            value={value}
            checked={model === value}
            onChange={() => onChange(value)}
          />
          <span>
            <strong>{modelLabels[value]}</strong>
            <small>
              {value === "haiku" ? "A faster answer" : "A more thorough look"}
            </small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
