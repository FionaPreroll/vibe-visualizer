<script lang="ts">
  import type { BatchVideo } from '../../core/export/exporter';
  import { formatBytes } from '../../core/util/format';
  import Icon from '../Icon.svelte';

  /** The videos of a batch (EX-09), each with its download while it is in browser storage. */
  let { videos }: { videos: BatchVideo[] } = $props();
</script>

<ul class="videos" data-testid="export-videos">
  {#each videos as video, index (index)}
    <li>
      <span class="file">{video.fileName} · {formatBytes(video.bytes)}</span>
      {#if video.url}
        <a
          class="button small"
          href={video.url}
          download={video.fileName}
          data-testid="export-video-download"
        >
          <Icon name="export" size={14} /> Download
        </a>
      {/if}
    </li>
  {/each}
</ul>
