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

    parent_table?: string;
    parent_table_index?: string;
    core_table?: string;
    is_core?: boolean;

    relationship_table?: string;
    relationship_column?: string;
    relationship_source?: 'powerschool-inferred';
}

export interface CachedTableInfo {
    description?: string;
    extended_by?: string[];
}

export interface CachedTable {
    _table?: CachedTableInfo;
    [fieldName: string]: CachedField | CachedTableInfo | undefined;
}

export type OracleMetadataCache = Record<string, CachedTable>;
