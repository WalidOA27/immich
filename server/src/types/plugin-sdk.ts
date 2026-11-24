/**
 * Local implementation of `@immich/plugin-sdk`'s public surface.
 *
 * `server` imports the plugin's types (and the `WorkflowTrigger` enum), but the package's
 * declarations and runtime live in `packages/plugin-sdk/dist`, which exists only after the
 * workspace package is built. Upstream builds it with `mise run plugins` before building
 * the server; the maintenance gate compiles and runs the server from a clean install
 * instead. `tsconfig.json` maps `@immich/plugin-sdk` here, so the server compiles and
 * starts without the built package (the emitted imports point at this file).
 *
 * The enum values and types are identical to `packages/plugin-sdk/src/types.ts` (and the
 * `@immich/sdk` symbols it imports): keep them in sync.
 */

enum WorkflowType {
  AssetV1 = 'AssetV1',
}

enum AssetTypeEnum {
  Image = 'IMAGE',
  Video = 'VIDEO',
  Audio = 'AUDIO',
  Other = 'OTHER',
}

enum AssetVisibility {
  Archive = 'archive',
  Timeline = 'timeline',
  Hidden = 'hidden',
  Locked = 'locked',
}

type TagResponseDto = {
  color?: string;
  createdAt: string;
  id: string;
  name: string;
  parentId?: string;
  updatedAt: string;
  value: string;
};

type DeepPartial<T> = T extends Date
  ? T
  : T extends Record<string, unknown>
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T extends Array<infer R>
      ? DeepPartial<R>[]
      : T;

export type WorkflowEventMap = {
  [WorkflowType.AssetV1]: AssetV1;
} & { [K in WorkflowType]: unknown };

export type WorkflowEventData<T extends WorkflowType> = WorkflowEventMap[T];

export enum WorkflowTrigger {
  AssetCreate = 'AssetCreate',
  AssetMetadataExtraction = 'AssetMetadataExtraction',
  AssetOcrExtraction = 'AssetOcrExtraction',
  AssetTagged = 'AssetTagged',
}

export type WorkflowEventPayload<T extends WorkflowType, TConfig = WorkflowStepConfig> = {
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

export type WorkflowChanges<T extends WorkflowType> = DeepPartial<WorkflowEventData<T>>;

export type WorkflowResponse<T extends WorkflowType> = {
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

export type WorkflowStepConfig = {
  [key: string]: ConfigValue;
};

export type ConfigValue =
  | string
  | number
  | boolean
  | null
  | ConfigValue[]
  | { [key: string]: ConfigValue };

export type AssetV1 = {
  asset: {
    id: string;
    ownerId: string;
    type: AssetTypeEnum;
    originalPath: string;
    fileCreatedAt: string;
    fileModifiedAt: string;
    isFavorite: boolean;
    checksum: Buffer;
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
    visibility: AssetVisibility;
    isEdited: boolean;
    tags: TagResponseDto[];
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
