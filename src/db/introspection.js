const LIST_TABLES_SQL = `
  SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS [name]
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_TYPE = 'BASE TABLE'
  ORDER BY TABLE_SCHEMA, TABLE_NAME
  OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
`;

const LIST_VIEWS_SQL = `
  SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS [name]
  FROM INFORMATION_SCHEMA.VIEWS
  ORDER BY TABLE_SCHEMA, TABLE_NAME
  OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
`;

const DESCRIBE_TABLE_WITH_SCHEMA_SQL = `
  SELECT
    COLUMN_NAME AS [name],
    DATA_TYPE AS [type],
    CHARACTER_MAXIMUM_LENGTH AS [maxLength],
    IS_NULLABLE AS [nullable],
    COLUMN_DEFAULT AS [default],
    ORDINAL_POSITION AS [position]
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @tschema AND TABLE_NAME = @tname
  ORDER BY ORDINAL_POSITION
`;

const DESCRIBE_TABLE_SQL = `
  SELECT
    COLUMN_NAME AS [name],
    DATA_TYPE AS [type],
    CHARACTER_MAXIMUM_LENGTH AS [maxLength],
    IS_NULLABLE AS [nullable],
    COLUMN_DEFAULT AS [default],
    ORDINAL_POSITION AS [position]
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = @tname
  ORDER BY ORDINAL_POSITION
`;

const LIST_INDEXES_SQL = `
  SELECT
    i.name AS [index],
    i.type_desc AS [type],
    CAST(i.is_unique AS BIT) AS [isUnique],
    CAST(i.is_primary_key AS BIT) AS [isPrimaryKey],
    STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS [columns]
  FROM sys.indexes i
  JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
  JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
  JOIN sys.tables t ON t.object_id = i.object_id
  JOIN sys.schemas s ON s.schema_id = t.schema_id
  WHERE t.name = @tname
    AND (@tschema IS NULL OR s.name = @tschema)
    AND i.name IS NOT NULL
  GROUP BY i.name, i.type_desc, i.is_unique, i.is_primary_key
  ORDER BY i.name
`;

const LIST_FOREIGN_KEYS_SQL = `
  SELECT
    fk.name AS [fk],
    OBJECT_SCHEMA_NAME(fkc.parent_object_id) + '.' + OBJECT_NAME(fkc.parent_object_id) AS [fromTable],
    pc.name AS [fromColumn],
    OBJECT_SCHEMA_NAME(fkc.referenced_object_id) + '.' + OBJECT_NAME(fkc.referenced_object_id) AS [toTable],
    rc.name AS [toColumn]
  FROM sys.foreign_keys fk
  JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
  JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
  JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
  WHERE (@tname IS NULL OR OBJECT_NAME(fkc.parent_object_id) = @tname)
    AND (@tschema IS NULL OR OBJECT_SCHEMA_NAME(fkc.parent_object_id) = @tschema)
  ORDER BY fk.name
  OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
`;

const COUNT_FOREIGN_KEYS_SQL = `
  SELECT COUNT(*) AS total
  FROM sys.foreign_keys fk
  JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
  WHERE (@tname IS NULL OR OBJECT_NAME(fkc.parent_object_id) = @tname)
    AND (@tschema IS NULL OR OBJECT_SCHEMA_NAME(fkc.parent_object_id) = @tschema)
`;

const LIST_PROCEDURES_SQL = `
  SELECT ROUTINE_SCHEMA AS [schema], ROUTINE_NAME AS [name]
  FROM INFORMATION_SCHEMA.ROUTINES
  WHERE ROUTINE_TYPE = 'PROCEDURE'
  ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
  OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
`;

const DESCRIBE_PROCEDURE_SQL = `
  SELECT
    PARAMETER_NAME AS [name],
    DATA_TYPE AS [type],
    PARAMETER_MODE AS [mode],
    ORDINAL_POSITION AS [position]
  FROM INFORMATION_SCHEMA.PARAMETERS
  WHERE SPECIFIC_NAME = @pname
    AND (@pschema IS NULL OR SPECIFIC_SCHEMA = @pschema)
  ORDER BY ORDINAL_POSITION
`;

const DESCRIBE_DATABASE_SQL = `
  SELECT
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE') AS [tableCount],
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.VIEWS) AS [viewCount],
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_TYPE = 'PROCEDURE') AS [procedureCount],
    DB_NAME() AS [databaseName],
    SUSER_SNAME() AS [currentUser]
`;

const COUNT_TABLES_SQL = `SELECT COUNT(*) AS total FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'`;
const COUNT_VIEWS_SQL = `SELECT COUNT(*) AS total FROM INFORMATION_SCHEMA.VIEWS`;
const COUNT_PROCEDURES_SQL = `SELECT COUNT(*) AS total FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_TYPE='PROCEDURE'`;

module.exports = {
  LIST_TABLES_SQL,
  LIST_VIEWS_SQL,
  DESCRIBE_TABLE_SQL,
  DESCRIBE_TABLE_WITH_SCHEMA_SQL,
  LIST_INDEXES_SQL,
  LIST_FOREIGN_KEYS_SQL,
  COUNT_FOREIGN_KEYS_SQL,
  LIST_PROCEDURES_SQL,
  DESCRIBE_PROCEDURE_SQL,
  DESCRIBE_DATABASE_SQL,
  COUNT_TABLES_SQL,
  COUNT_VIEWS_SQL,
  COUNT_PROCEDURES_SQL,
};
