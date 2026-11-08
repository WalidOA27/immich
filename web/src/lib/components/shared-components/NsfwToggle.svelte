<script lang="ts">
  // Fork addition (see FORK.md): Show / Blur / Hide NSFW assets in the timeline.
  import { nsfwMode, type NsfwMode } from '$lib/stores/nsfw.store';
  import { IconButton } from '@immich/ui';
  import { mdiBlur, mdiEye, mdiEyeOff } from '@mdi/js';
  import { t } from 'svelte-i18n';

  const modes = $derived([
    { mode: 'show' as NsfwMode, icon: mdiEye, label: $t('nsfw_mode_show') },
    { mode: 'blur' as NsfwMode, icon: mdiBlur, label: $t('nsfw_mode_blur') },
    { mode: 'hide' as NsfwMode, icon: mdiEyeOff, label: $t('nsfw_mode_hide') },
  ]);

  const select = (mode: NsfwMode) => {
    const reload = mode !== $nsfwMode && (mode === 'hide' || $nsfwMode === 'hide');
    nsfwMode.set(mode);
    if (reload) {
      // the timeline is rebuilt with or without the NSFW filter
      location.reload();
    }
  };
</script>

<div class="flex items-center rounded-full border border-gray-300 dark:border-gray-700" role="group">
  {#each modes as { mode, icon, label } (mode)}
    <IconButton
      shape="round"
      size="small"
      variant={$nsfwMode === mode ? 'filled' : 'ghost'}
      color={$nsfwMode === mode ? 'primary' : 'secondary'}
      {icon}
      title={label}
      aria-label={label}
      aria-pressed={$nsfwMode === mode}
      onclick={() => select(mode)}
    />
  {/each}
</div>
