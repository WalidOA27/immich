import { HttpError } from '@oazapfts/runtime';
export interface ApiValidationError {
    code: string;
    path: (string | number)[];
    message: string;
}
export interface ApiExceptionResponse {
    message: string;
    error?: string;
    statusCode: number;
    errors?: ApiValidationError[];
}
export interface ApiHttpError extends HttpError {
    data: ApiExceptionResponse;
}
export declare function isHttpError(error: unknown): error is ApiHttpError;
export declare class MalformedResponseError extends Error {
    readonly url: string;
    readonly status: number;
    readonly contentType: string | null;
    name: string;
    constructor(reason: string, url: string, status: number, contentType: string | null);
}
export declare function isMalformedResponseError(error: unknown): error is MalformedResponseError;
