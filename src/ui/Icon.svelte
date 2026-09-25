<script lang="ts" module>
  export const ICONS = {
    play: 'M8 5.5v13l11-6.5z',
    pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
    previous: 'M6 6h2v12H6zM9.5 12L18 18V6z',
    next: 'M16 6h2v12h-2zM6 18l8.5-6L6 6z',
    stop: 'M7 7h10v10H7z',
    plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
    trash: 'M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 11H7z',
    close:
      'M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z',
    fullscreen: 'M4 4h6v2H6v4H4zM14 4h6v6h-2V6h-4zM4 14h2v4h4v2H4zM18 14h2v6h-6v-2h4z',
    volume: 'M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 010 7l-1.4-1.4a3 3 0 000-4.2z',
    grip: 'M9 6h2v2H9zM13 6h2v2h-2zM9 11h2v2H9zM13 11h2v2h-2zM9 16h2v2H9zM13 16h2v2h-2z',
    music: 'M10 4h10v11a3 3 0 11-2-2.83V8h-6v9a3 3 0 11-2-2.83z',
    alert: 'M12 3l10 18H2zM11 10v5h2v-5zM11 17v2h2v-2z',
    panel: 'M3 5h18v14H3zM15 7v10h4V7z',
    wave: 'M2 12h3l2-6 3 12 3-9 2 6 2-3h5',
    ring: 'M12 3a9 9 0 110 18 9 9 0 010-18zm0 5a4 4 0 100 8 4 4 0 000-8z',
    kaleido:
      'M12 2l2.2 6.8L21 7.5l-4.6 5L21 17.5l-6.8-1.3L12 23l-2.2-6.8L3 17.5l4.6-5L3 7.5l6.8 1.3z',
    sliders: 'M4 6h9v2H4zM17 6h3v2h-3zM13 4h4v6h-4zM4 16h3v2H4zM11 16h9v2h-9zM7 14h4v6H7z',
    image: 'M3 5h18v14H3zM5 17h14l-4.5-6-3.5 4.5L8.5 12z',
    save: 'M5 3h11l3 3v15H5zM8 5v4h7V5zM8 13v6h8v-6z',
    export: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    safe: 'M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M9 9h6v6H9z',
    markIn: 'M9 5v14M9 5h6M9 19h6',
    markOut: 'M15 5v14M15 5H9M15 19H9',
  } as const;
  /** Icons drawn as lines instead of filled shapes. */
  const STROKED: readonly string[] = ['wave', 'export', 'safe', 'markIn', 'markOut'];
  export type IconName = keyof typeof ICONS;
</script>

<script lang="ts">
  interface Props {
    name: IconName;
    size?: number;
  }
  let { name, size = 20 }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  aria-hidden="true"
  class:stroke={STROKED.includes(name)}
>
  <path d={ICONS[name]} />
</svg>

<style>
  svg {
    display: block;
    fill: currentColor;
    flex-shrink: 0;
  }
  svg.stroke {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
</style>
