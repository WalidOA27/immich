// Fallback types for `@immich/plugin-sdk` when its `dist/` has not been built yet.
//
// `@immich/plugin-sdk` is a workspace package whose `dist/` is gitignored. The container image
// builds it before the server (see `server/Dockerfile`), but the server can also be built on its
// own (`cd server && pnpm build`, which is what regenerates the OpenAPI spec with
// `mise run sync-open-api`) from a fresh checkout where that `dist/` does not exist.
//
// TypeScript only uses this ambient declaration when the real module cannot be resolved: as soon
// as `packages/plugin-sdk/dist/` exists (normal builds, tests, the image) the shipped declarations
// win, so a drift with `packages/plugin-sdk/src/types.ts` is caught by `pnpm check` and the image
// build rather than silently hidden. Keep these declarations in sync with the plugin SDK.
declare module '@immich/plugin-sdk' {
  export type ConfigValue = string | number | boolean | null | ConfigValue[] | { [key: string]: ConfigValue };

  export type WorkflowStepConfig = {
    [key: string]: ConfigValue;
  };

  export enum WorkflowTrigger {
    AssetCreate = 'AssetCreate',
    AssetMetadataExtraction = 'AssetMetadataExtraction',
    AssetOcrExtraction = 'AssetOcrExtraction',
    AssetTagged = 'AssetTagged',
  }

  type DeepPartial<T> = T extends Date
    ? T
    : T extends Record<string, unknown>
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T extends Array<infer R>
        ? DeepPartial<R>[]
        : T;

  export type AssetV1 = {
    asset: {
      id: string;
      ownerId: string;
      // The plugin SDK takes these from `@immich/sdk`; the server uses its own enums.
      type: import('./enum.js').AssetType;
      originalPath: string;
      fileCreatedAt: string;
      fileModifiedAt: string;
      isFavorite: boolean;
      checksum: Buffer; // sha1 checksum
      livePhotoVideoId: string | null;
      updatedAt: string;
      createdAt: string;
      originalFileName: string;
      isOffline: boolean;
      libraryId: string | null;
      isExternal: boolean;
      deletedAt: string | null;
      localDateTime: string;
      stackId: string | null;
      duplicateId: string | null;
      visibility: import('./enum.js').AssetVisibility;
      isEdited: boolean;
      tags: unknown[];
      exifInfo: {
        make: string | null;
        model: string | null;
        exifImageWidth: number | null;
        exifImageHeight: number | null;
        fileSizeInByte: number | null;
        orientation: string | null;
        dateTimeOriginal: string | null;
        modifyDate: string | null;
        lensModel: string | null;
        fNumber: number | null;
        focalLength: number | null;
        iso: number | null;
        latitude: number | null;
        longitude: number | null;
        city: string | null;
        state: string | null;
        country: string | null;
        description: string | null;
        fps: number | null;
        exposureTime: string | null;
        livePhotoCID: string | null;
        timeZone: string | null;
        projectionType: string | null;
        profileDescription: string | null;
        colorspace: string | null;
        bitsPerSample: number | null;
        autoStackId: string | null;
        rating: number | null;
        tags: string[] | null;
        updatedAt: string | null;
      } | null;
      ocr?: {
        text: string;
        textScore: number;
        boxScore: number;
      }[];
    };
  };

  export type WorkflowEventMap = { [K in string]: AssetV1 };

  export type WorkflowEventData<T extends string> = WorkflowEventMap[T];

  export type WorkflowEventPayload<T extends string, TConfig = WorkflowStepConfig> = {
    trigger: WorkflowTrigger;
    type: T;
    data: WorkflowEventData<T>;
    config: TConfig;
    workflow: {
      id: string;
      authToken: string;
      stepId: string;
      debug?: boolean;
    };
  };

  export type WorkflowChanges<T extends string> = DeepPartial<WorkflowEventData<T>>;

  export type WorkflowResponse<T extends string> = {
    workflow?: {
      /** stop the workflow */
      continue?: boolean;
    };
    changes?: WorkflowChanges<T>;
    /** data to be passed to the next workflow step */
    data?: Record<string, unknown>;
    /** update step config */
    config?: WorkflowStepConfig;
  };
}
