<script lang="ts">
  /** A labelled range slider with its value; double-click the label to reset. */
  interface Props {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    /** Formats the value for display. */
    format?: (value: number) => string;
    defaultValue?: number;
    onchange: (value: number) => void;
  }
  let {
    label,
    value,
    min,
    max,
    step = (max - min) / 100,
    format = (v) => v.toFixed(2),
    defaultValue,
    onchange,
  }: Props = $props();
  const id = `slider-${Math.random().toString(36).slice(2)}`;
</script>

<div class="slider">
  <label
    for={id}
    ondblclick={() => defaultValue !== undefined && onchange(defaultValue)}
    title={defaultValue !== undefined ? 'Double-click to reset' : undefined}
  >
    {label}
  </label>
  <input
    {id}
    type="range"
    {min}
    {max}
    {step}
    {value}
    oninput={(event) => onchange(Number(event.currentTarget.value))}
  />
  <output for={id}>{format(value)}</output>
</div>

<style>
  .slider {
    display: grid;
    grid-template-columns: 104px minmax(0, 1fr) 56px;
    align-items: center;
    gap: 8px;
    min-height: 30px;
  }
  label {
    font-size: 13px;
    color: var(--muted);
    user-select: none;
  }
  input {
    width: 100%;
    accent-color: var(--accent);
  }
  output {
    font: 12px var(--mono);
    text-align: right;
    color: var(--muted);
  }
</style>
