export type ConnectionType = 'serviceName' | 'sid';
export type MetadataMode = 'generic' | 'powerschool';

export interface OracleConnection {
    name: string;
    user: string;
    host: string;
    port: number;
    serviceName: string;
    sid: string;
    owner?: string;
    connectionType: 'serviceName' | 'sid';
    metadataSource?: 'generic' | 'powerschool' | 'custom';
    customMetadataQuery?: string;
}

export interface CachedField {
    field_data_type: string;
    description?: string;
}

export interface CachedTableInfo {
    description?: string;
}

export interface CachedTable {
    _table?: CachedTableInfo;
    [fieldName: string]: CachedField | CachedTableInfo | undefined;
}

export type OracleMetadataCache = Record<string, CachedTable>;
