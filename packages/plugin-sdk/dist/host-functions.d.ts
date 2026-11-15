import { getAllAlbums, type AlbumResponseDto, type BulkIdResponseDto, type CreateAlbumDto, type TagBulkAssetsDto, type TagBulkAssetsResponseDto } from '@immich/sdk';
declare module 'extism:host' {
    interface user extends Record<(typeof availableFunctions)[number], (ptr: PTR) => I64> {
    }
}
type AlbumsToAssets = {
    assetIds: string[];
    albumIds: string[];
};
type QueryParams<T extends (...args: any) => any> = Parameters<T>[0];
type AlbumSearchDto = QueryParams<typeof getAllAlbums>;
type HttpRequestOptions = {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
};
type HttpResponse = {
    ok: string;
    status: number;
    body: string;
};
export declare const availableFunctions: readonly ['searchAlbums', 'createAlbum', 'addAssetsToAlbum', 'addAssetsToAlbums', 'httpRequest', 'bulkTagAssets'];
export declare const hostFunctions: (authToken: string) => {
    searchAlbums: (dto: AlbumSearchDto) => AlbumResponseDto[];
    createAlbum: (dto: CreateAlbumDto) => AlbumResponseDto;
    addAssetsToAlbum: (albumId: string, assetIds: string[]) => BulkIdResponseDto[];
    addAssetsToAlbums: ({ assetIds, albumIds }: AlbumsToAssets) => unknown;
    httpRequest: (url: string, options?: HttpRequestOptions) => HttpResponse;
    bulkTagAssets: (dto: TagBulkAssetsDto) => TagBulkAssetsResponseDto;
};
export {};
