<script lang="ts">
  import type { AspectRatio } from '../core/export/video-format';

  /**
   * Safe-area guides over the stage (VE-09): the title-safe frame (90 %), and on 9:16 the parts
   * that TikTok, Shorts and Reels cover with their buttons and captions. Never rendered into the
   * video.
   */
  interface Props {
    aspect: AspectRatio;
  }
  let { aspect }: Props = $props();
</script>

<div class="safe" aria-hidden="true" data-testid="safe-areas">
  <div class="title-safe"></div>
  {#if aspect === '9:16'}
    <div class="covered top"><span>Top bar</span></div>
    <div class="covered side"><span>Buttons</span></div>
    <div class="covered bottom"><span>Caption and sound</span></div>
  {/if}
</div>

<style>
  .safe {
    position: absolute;
    inset: 0;
    pointer-events: none;
    container-type: size;
  }
  .title-safe {
    position: absolute;
    inset: 5%;
    border: 1px dashed rgba(255, 255, 255, 0.45);
  }
  .covered {
    position: absolute;
    display: grid;
    place-items: center;
    background: rgba(255, 70, 110, 0.16);
    border: 1px dashed rgba(255, 110, 140, 0.7);
  }
  .covered span {
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: clamp(9px, 2.6cqw, 13px);
    white-space: nowrap;
  }
  /* Approximate areas the apps cover in their 1080 × 1920 layout, generously rounded. */
  .top {
    left: 0;
    right: 0;
    top: 0;
    height: 7%;
  }
  .bottom {
    left: 0;
    right: 0;
    bottom: 0;
    height: 21%;
  }
  .side {
    right: 0;
    top: 38%;
    width: 13%;
    height: 41%;
  }
  .side span {
    writing-mode: vertical-rl;
  }
</style>
