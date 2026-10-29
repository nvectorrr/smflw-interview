import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";

type Option<Value extends string> = {
  value: Value;
  label: string;
  description?: string;
};

export function SelectDropdown<Value extends string>({
  value,
  onChange,
  label,
  options,
  disabled = false,
  searchable = false,
  className = "",
}: {
  value: Value;
  onChange: (value: Value) => void;
  label: string;
  options: Option<Value>[];
  disabled?: boolean;
  searchable?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<CSSProperties>({});
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const search = useRef({ text: "", time: 0 });
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const unavailable = disabled || options.length === 0;
  const visibleOptions = searchable
    ? options.filter((option) =>
        `${option.label} ${option.description ?? ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
    : options;

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const box = trigger.current?.getBoundingClientRect();
      if (!box || !menu.current) return;
      const below = Math.max(0, window.innerHeight - box.bottom - 14);
      const above = Math.max(0, box.top - 14);
      const desired = Math.min(320, menu.current.scrollHeight + 2);
      const upwards = below < desired && above > below;
      const width = Math.min(
        Math.max(
          box.width,
          options.some((option) => option.description) ? 280 : 220,
        ),
        window.innerWidth - 16,
      );
      setPosition({
        width,
        left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)),
        maxHeight: Math.min(320, upwards ? above : below),
        top: upwards ? undefined : box.bottom + 6,
        bottom: upwards ? window.innerHeight - box.top + 6 : undefined,
      });
    }
    function scroll(event: Event) {
      if (!menu.current?.contains(event.target as Node)) place();
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", scroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [open, options, query]);
  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const index = Math.max(0, Math.min(active, visibleOptions.length - 1));
    if (index !== active) {
      setActive(Math.max(0, index));
      return;
    }
    if (!searchable) items.current[index]?.focus({ preventScroll: true });
    items.current[index]?.scrollIntoView({ block: "nearest" });
  }, [open, active, visibleOptions.length, searchable]);
  useEffect(() => {
    if (open && searchable) searchInput.current?.focus({ preventScroll: true });
  }, [open, searchable]);
  useEffect(() => {
    if (unavailable) setOpen(false);
  }, [unavailable]);

  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  function keydown(event: KeyboardEvent) {
    if (unavailable || event.nativeEvent.isComposing) return;
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab" && open) {
      close();
    } else if (searchable && open && event.key === "Enter") {
      event.preventDefault();
      const option = visibleOptions[active];
      if (option) {
        close();
        if (option.value !== value) onChange(option.value);
      }
    } else if (
      ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) &&
      !(searchable && open && ["Home", "End"].includes(event.key))
    ) {
      event.preventDefault();
      const count =
        !open && searchable ? options.length : visibleOptions.length;
      if (!open) setQuery("");
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? Math.max(0, count - 1)
            : !open
              ? selected
              : count
                ? (active + (event.key === "ArrowDown" ? 1 : -1) + count) %
                  count
                : 0;
      search.current.text = "";
      setActive(next);
      setOpen(true);
    } else if (
      open &&
      !searchable &&
      event.key.length === 1 &&
      event.key !== " " &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      const letter = event.key.toLowerCase();
      const text =
        Date.now() - search.current.time < 600
          ? search.current.text + letter
          : letter;
      search.current = { text, time: Date.now() };
      const prefix = [...text].every((character) => character === letter)
        ? letter
        : text;
      const start = prefix.length > 1 ? active : active + 1;
      for (let step = 0; step < options.length; step++) {
        const next = (start + step) % options.length;
        if (options[next].label.toLowerCase().startsWith(prefix)) {
          setActive(next);
          break;
        }
      }
    }
  }

  return (
    <div
      className={`select-dropdown ${className}`}
      ref={root}
      onKeyDown={keydown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="select-trigger"
        ref={trigger}
        aria-label={`${label}: ${options.find((option) => option.value === value)?.label ?? value}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={unavailable}
        onClick={() => {
          search.current.text = "";
          if (!open) setQuery("");
          setActive(selected);
          setOpen(!open);
        }}
      >
        <span className="select-value">
          {options.find((option) => option.value === value)?.label ?? value}
        </span>
        <span className="select-chevron" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </span>
      </button>
      <div
        className="select-options"
        data-open={open}
        data-searchable={searchable}
        data-side={position.bottom === undefined ? "bottom" : "top"}
        inert={!open}
        aria-hidden={!open}
        ref={menu}
        style={position}
      >
        {searchable && (
          <div className="select-search">
            <input
              ref={searchInput}
              type="text"
              role="combobox"
              aria-label={`Search ${label.toLowerCase()}`}
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={id}
              aria-activedescendant={
                open && visibleOptions[active]
                  ? `${id}-option-${active}`
                  : undefined
              }
              placeholder="Search by name or email"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
            />
          </div>
        )}
        <div id={id} role="listbox" aria-label={label}>
          {visibleOptions.map((option, index) => (
            <button
              key={option.value}
              id={`${id}-option-${index}`}
              className="select-option"
              data-active={searchable && active === index}
              ref={(element) => {
                items.current[index] = element;
              }}
              type="button"
              role="option"
              aria-selected={value === option.value}
              tabIndex={!searchable && open && active === index ? 0 : -1}
              onFocus={() => setActive(index)}
              onClick={() => {
                close();
                if (option.value !== value) onChange(option.value);
              }}
            >
              <span className="select-option-copy">
                <strong>{option.label}</strong>
                {option.description && <small>{option.description}</small>}
              </span>
              <span className="select-check" aria-hidden="true">
                {value === option.value ? "✓" : ""}
              </span>
            </button>
          ))}
        </div>
        {visibleOptions.length === 0 && (
          <div className="select-empty" role="status">
            No matches found
          </div>
        )}
      </div>
    </div>
  );
}
