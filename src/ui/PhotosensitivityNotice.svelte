<script lang="ts">
  /**
   * Warning before the first flashing visuals (VE-05). Shown once; the choice is remembered.
   */
  const KEY = 'vibe-visualizer:photosensitivity-ack';

  function acknowledged(): boolean {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  }

  let open = $state(!acknowledged());
  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (open && dialog && !dialog.open) dialog.showModal();
  });

  function accept() {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // Not stored: the notice shows again next time.
    }
    open = false;
    dialog?.close();
  }
</script>

{#if open}
  <dialog
    bind:this={dialog}
    aria-labelledby="photosensitivity-title"
    oncancel={(event) => event.preventDefault()}
  >
    <h2 id="photosensitivity-title">Flashing visuals</h2>
    <p>
      The visuals react to music with fast movement, flashes and strong contrasts. If you or anyone
      watching may be sensitive to flashing light (photosensitive epilepsy), please take care.
    </p>
    <button class="primary" onclick={accept} data-testid="photosensitivity-ok">
      I understand
    </button>
  </dialog>
{/if}

<style>
  dialog {
    max-width: 440px;
    padding: 24px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
  }
  dialog::backdrop {
    background: rgba(5, 5, 10, 0.75);
  }
  h2 {
    margin: 0 0 10px;
    font-size: 20px;
  }
  p {
    margin: 0 0 20px;
    color: var(--muted);
  }
</style>
