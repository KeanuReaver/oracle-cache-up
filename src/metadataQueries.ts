export function getGenericOracleMetadataQuery(): string {
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
						'table_desc'        VALUE atcom.comments,
						'column_desc'       VALUE accom.comments
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