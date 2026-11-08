import { persisted } from 'svelte-persisted-store';

// Fork addition (see FORK.md): per-browser NSFW display mode.
export type NsfwMode = 'show' | 'blur' | 'hide';

export const nsfwMode = persisted<NsfwMode>('nsfw-mode', 'show');
