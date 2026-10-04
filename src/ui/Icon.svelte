<script lang="ts" module>
  export const ICONS = {
    play: 'M8 5.5v13l11-6.5z',
    pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
    previous: 'M6 6h2v12H6zM9.5 12L18 18V6z',
    next: 'M16 6h2v12h-2zM6 18l8.5-6L6 6z',
    stop: 'M7 7h10v10H7z',
    plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
    minus: 'M5 11h14v2H5z',
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
    live: 'M12 9a3 3 0 110 6 3 3 0 010-6zM7.8 7.8a6 6 0 000 8.4M16.2 7.8a6 6 0 010 8.4M5 5a10 10 0 000 14M19 5a10 10 0 010 14',
    knob: 'M12 4a8 8 0 110 16 8 8 0 010-16zM12 12l4-4',
    shuffle: 'M3 7h4l10 10h4M3 17h4l3-3M14 10l3-3h4M18 4l3 3-3 3M18 14l3 3-3 3',
    repeat: 'M4 12V9a3 3 0 013-3h12M16 3l3 3-3 3M20 12v3a3 3 0 01-3 3H5M8 21l-3-3 3-3',
    folder: 'M3 6h6l2 2h10v11H3z',
    lock: 'M8 11V8a4 4 0 018 0v3M5 11h14v10H5z',
    magnet: 'M6 4v8a6 6 0 0012 0V4M10 4v8a2 2 0 004 0V4M6 8h4M14 8h4',
    controller:
      'M3 7h18v10H3zM10.5 12a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM18.5 12a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z',
    star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
    starOutline: 'M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z',
    import: 'M12 20V9M7 14l5-5 5 5M5 4h14',
    pencil: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
    camera: 'M3 8h4l2-3h6l2 3h4v11H3zM12 10a3.5 3.5 0 110 7 3.5 3.5 0 010-7z',
    visualsOff:
      'M3 12s3.5-6 9-6c1.3 0 2.5.3 3.6.8M20 9.5c.7.9 1 1.6 1 2.5 0 0-3.5 6-9 6-1.3 0-2.5-.3-3.6-.8M10 12a2 2 0 012-2M4 20L20 4',
    more: 'M5 10.25a1.75 1.75 0 110 3.5 1.75 1.75 0 010-3.5zM12 10.25a1.75 1.75 0 110 3.5 1.75 1.75 0 010-3.5zM19 10.25a1.75 1.75 0 110 3.5 1.75 1.75 0 010-3.5z',
    gear: 'M9.9 5.1L10.2 2.7L13.8 2.7L14.1 5.1L15.4 5.6L17.3 4.1L19.9 6.7L18.4 8.6L18.9 9.9L21.3 10.2L21.3 13.8L18.9 14.1L18.4 15.4L19.9 17.3L17.3 19.9L15.4 18.4L14.1 18.9L13.8 21.3L10.2 21.3L9.9 18.9L8.6 18.4L6.7 19.9L4.1 17.3L5.6 15.4L5.1 14.1L2.7 13.8L2.7 10.2L5.1 9.9L5.6 8.6L4.1 6.7L6.7 4.1L8.6 5.6ZM12 9a3 3 0 110 6 3 3 0 010-6z',
  } as const;
  /** Icons drawn as lines instead of filled shapes. */
  const STROKED: readonly string[] = [
    'wave',
    'export',
    'safe',
    'markIn',
    'markOut',
    'live',
    'knob',
    'shuffle',
    'repeat',
    'folder',
    'lock',
    'magnet',
    'controller',
    'starOutline',
    'import',
    'pencil',
    'camera',
    'visualsOff',
    'gear',
  ];
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
