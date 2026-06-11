import { OracleConnection } from './types';

export function getGenericOracleMetadataQuery(): string {
	return `
		SELECT
			JSON_ARRAYAGG(
				JSON_OBJECT(
					'table_name' VALUE atc.table_name,
					'field_name' VALUE atc.column_name,
					'field_data_type' VALUE
						CASE
							WHEN atc.data_type IN ('VARCHAR2', 'CHAR', 'NVARCHAR2', 'NCHAR')
								THEN atc.data_type || chr(40) || atc.char_length || chr(41)
							WHEN atc.data_type = 'NUMBER' AND atc.data_precision IS NOT NULL AND atc.data_scale IS NOT NULL
								THEN atc.data_type || chr(40) || atc.data_precision || ',' || atc.data_scale || chr(41)
							WHEN atc.data_type = 'NUMBER' AND atc.data_precision IS NOT NULL
								THEN atc.data_type || chr(40) || atc.data_precision || chr(41)
							ELSE atc.data_type
						END
					RETURNING CLOB
				)
				ORDER BY atc.table_name, atc.column_id
				RETURNING CLOB
			) AS CACHE_JSON
		FROM all_tab_columns atc
		WHERE (:owner IS NULL OR atc.owner = :owner)
	`;
}

export function getPowerSchoolMetadataQuery(): string {
	return `
		SELECT
			coalesce(
				json_arrayagg(
					json_object(
						'table_name'        VALUE atc.table_name,
						'field_name'        VALUE atc.column_name,
						'field_data_type'   VALUE CASE
													WHEN atc.data_type IN ('VARCHAR2', 'CHAR', 'NVARCHAR2', 'NCHAR')
														THEN atc.data_type || chr(40) || atc.char_length || chr(41)
													WHEN atc.data_type = 'NUMBER'
														AND atc.data_precision IS NOT NULL
														AND atc.data_scale IS NOT NULL
														THEN atc.data_type || chr(40) || atc.data_precision || ',' || atc.data_scale || chr(41)
													WHEN atc.data_type = 'NUMBER'
														AND atc.data_precision IS NOT NULL
														THEN atc.data_type || chr(40) || atc.data_precision || chr(41)
													ELSE atc.data_type
												END,
						'table_desc'        VALUE COALESCE(pb_dict.table_desc, cust_dict.table_desc, atcom.comments, ''),
						'column_desc'       VALUE COALESCE(pb_dict.field_desc, cust_dict.field_desc, accom.comments, '')
						returning clob
					)
					ORDER BY atc.table_name, atc.column_id
					returning clob
				),
				to_clob(chr(91)||chr(93))
			) AS CACHE_JSON
		FROM all_tab_columns atc
            LEFT JOIN all_tab_comments atcom
                ON atcom.owner = atc.owner
                AND atcom.table_name = atc.table_name
            LEFT JOIN all_col_comments accom
                ON accom.owner = atc.owner
                AND accom.table_name = atc.table_name
                AND accom.column_name = atc.column_name
            LEFT JOIN (
                SELECT 
                    UPPER(dictionaryobject.objectname) AS table_name_uc,
                    UPPER(dictionarycolumn.columnname) AS column_name_uc,
                    dictionaryobject.objectname 
                        || CASE WHEN dictionaryobject.objectnumber IS NOT NULL 
                            THEN ', ' || dictionaryobject.objectnumber 
                        END 
                        || ' ' || chr(40) || dictionaryobject.objectversion || chr(41) AS table_title,
                    dictionaryobject.objectdescription AS table_desc,
                    dictionarycolumn.columnversion AS field_version,
                    dictionarycolumn.columndescription AS field_desc
                FROM dictionarycolumn
                INNER JOIN dictionaryobject 
                    ON dictionaryobject.objectname = dictionarycolumn.tablename
            ) pb_dict
                ON pb_dict.table_name_uc = atc.table_name
                AND pb_dict.column_name_uc = atc.column_name
            LEFT JOIN (
                SELECT 
                    UPPER(extschemadeftable.dbtablename) AS table_name_uc,
                    UPPER(extschemadeffield.name) AS column_name_uc,
                    extschemadeftable.dbtablename AS table_title,
                    extschemadeftable.commentvalue AS table_desc,
                    '1.0.0' AS field_version,
                    extschemadeffield.commentvalue
                        || CASE WHEN extschemadeffield.defaultvalue IS NOT NULL 
                            THEN ' ' || chr(40) || 'Default' || chr(58) || ' ' || extschemadeffield.defaultvalue || chr(41) 
                        END AS field_desc
                FROM extschemadeftable
                INNER JOIN extschemadeffield 
                    ON extschemadeffield.extschematable_id = extschemadeftable.id
            ) cust_dict
                ON cust_dict.table_name_uc = atc.table_name
                AND cust_dict.column_name_uc = atc.column_name
            LEFT JOIN (
                SELECT 
                    table_name, 
                    COALESCE(
                        MAX(NVL(core_table, '')),
                        'INDEPENDENT TABLE'
                    ) AS core_table
                FROM (
                    SELECT UPPER(dbtablename) AS table_name, UPPER(coretable) AS core_table
                    FROM extschemadeftable
                )
                GROUP BY table_name
            ) table_core_map
                ON table_core_map.table_name = atc.table_name
            LEFT JOIN (
                SELECT
                    extschemadeftable.dbtablename AS table_name,
                    extschemadeftable.foreignkey AS indexed_field,
                    extschemadeftable.coretable AS parent_table,
                    extschemadeftable.coretablepk AS parent_table_index
                FROM
                    extschemadeftable
            ) index_table ON upper(index_table.table_name) = upper(atc.table_name)
                AND upper(index_table.indexed_field) = upper(atc.column_name)

		WHERE (:owner IS NULL OR atc.owner = :owner)
		ORDER BY
			atc.table_name,
			atc.column_id
	`;
}

export function getSpecificTableDefinition(): string {
	return `
		SELECT
			COELSECE(
				JSON_ARRAYAGG(
					JSON_OBJECT(
						'table_name' VALUE all_tab_columns.table_name,
						'field_name' VALUE all_tab_columns.field_name,
						'field_data_type' VALUE CASE
								WHEN atc.data_type IN ('VARCHAR2', 'CHAR', 'NVARCHAR2', 'NCHAR')
									THEN atc.data_type || chr(40) || atc.char_length || chr(41)
								WHEN atc.data_type = 'NUMBER' AND atc.data_precision IS NOT NULL AND atc.data_scale IS NOT NULL
									THEN atc.data_type || chr(40) || atc.data_precision || ',' || atc.data_scale || chr(41)
								WHEN atc.data_type = 'NUMBER' AND atc.data_precision IS NOT NULL
									THEN atc.data_type || chr(40) || atc.data_precision || chr(41)
								ELSE atc.data_type
							END
						RETURNING CLOB
					)
					ORDER BY all_tab_columns.table_name, all_tab_columns.field_name
					RETURNING CLOB
				),
				to_clob(chr(91)||chr(93))
			) AS hover_json
		FROM
			all_tab_columns
		WHERE
			all_tab_columns.table_name = :hover_table		
	`;
}

export function getSpecificFieldDefinition(): string {
	return `
		SELECT
			COELSECE(
				JSON_ARRAYAGG(
					JSON_OBJECT(
						'table_name' VALUE all_tab_columns.table_name,
						'field_name' VALUE all_tab_columns.field_name,
						'field_data_type' VALUE CASE
								WHEN atc.data_type IN ('VARCHAR2', 'CHAR', 'NVARCHAR2', 'NCHAR')
									THEN atc.data_type || chr(40) || atc.char_length || chr(41)
								WHEN atc.data_type = 'NUMBER' AND atc.data_precision IS NOT NULL AND atc.data_scale IS NOT NULL
									THEN atc.data_type || chr(40) || atc.data_precision || ',' || atc.data_scale || chr(41)
								WHEN atc.data_type = 'NUMBER' AND atc.data_precision IS NOT NULL
									THEN atc.data_type || chr(40) || atc.data_precision || chr(41)
								ELSE atc.data_type
							END
						RETURNING CLOB
					)
					ORDER BY all_tab_columns.table_name, all_tab_columns.field_name
					RETURNING CLOB
				),
				to_clob(chr(91)||chr(93))
			) AS hover_json
		FROM
			all_tab_columns
		WHERE
			all_tab_columns.table_name = :hover_table
			AND all_tab_columns.field_name = :hover_field	
	`;
}

export function getMetadataQuery(connection: OracleConnection): string {
    const source = connection.metadataSource ?? 'generic';

    if (source === 'powerschool') {
        return getPowerSchoolMetadataQuery();
    }

    if (source === 'custom') {
        if (!connection.customMetadataQuery?.trim()) {
            throw new Error('Custom metadata query is empty.');
        }

        return connection.customMetadataQuery;
    }

    return getGenericOracleMetadataQuery();
}

export function validateCustomMetadataQuery(query: string): string[] {
    const requiredAliases = [
        'table_name',
        'field_name',
        'field_data_type'
    ];

    const normalized = query
        .toLowerCase()
        .replace(/\s+/g, ' ');

    return requiredAliases.filter(alias =>
        !normalized.includes(` ${alias}`)
        && !normalized.includes(` as ${alias}`)
    );
}