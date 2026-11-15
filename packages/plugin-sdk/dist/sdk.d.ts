import { hostFunctions } from './host-functions.js';
import type { WorkflowEventPayload, WorkflowResponse } from './types.js';
type Property = {
    type: 'string' | 'boolean' | 'number';
    array?: boolean;
    enum?: string[];
} & {
    type: 'object';
    properties: {
        [K: string]: Property;
    };
    required?: string[];
};
type RequiredProperties<Properties extends {
    [K: string]: unknown;
}, Required extends string[] | undefined, RequiredKeys extends string = Required extends undefined ? never : NonNullable<Required>[number]> = {
    properties: Pick<Properties, RequiredKeys> & Partial<Omit<Properties, RequiredKeys>>;
};
type GetConfigType<T extends Property> = 'enum' extends keyof T ? NonNullable<T['enum']>[number] : T['type'] extends 'boolean' ? boolean : T['type'] extends 'number' ? number : T['type'] extends 'string' ? string : T['type'] extends 'object' ? ConfigValue<T> : never;
type ConfigValue<T extends {
    properties: {
        [K: string]: Property;
    };
    required?: string[];
}, Properties extends {
    [K: string]: Property;
} = T['properties']> = T extends never ? never : RequiredProperties<{
    [K in keyof Properties]: Properties[K]['array'] extends true ? Array<GetConfigType<Properties[K]>> : GetConfigType<Properties[K]>;
}, 'required' extends keyof T ? T['required'] : undefined>['properties'];
export declare const wrapper: <T extends Record<string, any>>(methods: { [K in T['methods'][number] as K['name']]: (payload: WorkflowEventPayload<K['types'][number], ConfigValue<K['schema']>> & {
    functions: ReturnType<typeof hostFunctions>;
}) => WorkflowResponse<K['types'][number]> | undefined; }) => { [K in keyof { [K in T["methods"][number] as K["name"]]: (payload: WorkflowEventPayload<K['types'][number], ConfigValue<K['schema']>> & {
    functions: ReturnType<typeof hostFunctions>;
}) => WorkflowResponse<K['types'][number]> | undefined; }]: () => void; };
export {};
