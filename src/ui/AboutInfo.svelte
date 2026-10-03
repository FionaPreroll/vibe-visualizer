<script lang="ts">
  import { APP_VERSION, builtAtText } from '../core/env/version';
  import { usePlayer } from './player-context';

  /** The version of the app on the About page: what is running, and when it was built. */
  const app = usePlayer().store;
</script>

<dl class="about" data-testid="about-info">
  <dt>Version</dt>
  <dd data-testid="about-version">{$app.settings.appName} v{APP_VERSION}</dd>
  <dt>Built</dt>
  <dd>{builtAtText()}</dd>
</dl>

<style>
  .about {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 4px 14px;
    margin: 0 0 16px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface-2);
    font-size: 14px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
</style>
