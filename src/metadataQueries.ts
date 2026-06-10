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
