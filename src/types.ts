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
	connectionType: ConnectionType;
}

export interface CachedField {
	field_data_type: string;
}

export type OracleMetadataCache = Record<string, Record<string, CachedField>>;
